import Anthropic from '@anthropic-ai/sdk'
import { db } from '../db'
import { computeTrueProfit, MarginConfig } from './margin'
import { projectSum } from './forecasting'

// Self-contained SQL for every tool, deliberately NOT reusing reports.ts's
// route-local query functions — same isolation reasoning as insightsAgent.ts's
// existing gatherLast30DaysData/campaignDetail.ts, to avoid touching code the
// report routes depend on. Each tool answers one specific, bounded question;
// Claude decides which to call based on the user's actual question.

async function getMarginConfig(clientId: string): Promise<MarginConfig | null> {
  const { rows } = await db.query<MarginConfig>(
    `SELECT cogs_percent, payment_fee_percent, fulfillment_cost_flat FROM clients WHERE id = $1`,
    [clientId]
  )
  return rows[0] ?? null
}

async function getOverviewMetrics(clientId: string, days: number): Promise<object> {
  const until = new Date()
  const since = new Date(until)
  since.setUTCDate(since.getUTCDate() - (days - 1))
  const sinceStr = since.toISOString().slice(0, 10)
  const untilStr = until.toISOString().slice(0, 10)

  const [costRow, revenueRow, salesRow, leadsRow, margin] = await Promise.all([
    db.query<{ total: string }>(
      `SELECT COALESCE(SUM(spend),0) AS total FROM ad_costs WHERE client_id=$1 AND date BETWEEN $2 AND $3`,
      [clientId, sinceStr, untilStr]
    ),
    db.query<{ total: string }>(
      `SELECT COALESCE(SUM(a.attributed_revenue),0) AS total FROM attributions a JOIN purchases p ON p.id=a.purchase_id
       WHERE a.client_id=$1 AND p.purchased_at::date BETWEEN $2 AND $3`,
      [clientId, sinceStr, untilStr]
    ),
    db.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM purchases WHERE client_id=$1 AND purchased_at::date BETWEEN $2 AND $3 AND NOT refunded`,
      [clientId, sinceStr, untilStr]
    ),
    db.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM leads WHERE client_id=$1 AND created_at::date BETWEEN $2 AND $3`,
      [clientId, sinceStr, untilStr]
    ),
    getMarginConfig(clientId),
  ])

  const cost = parseFloat(costRow.rows[0].total)
  const revenue = parseFloat(revenueRow.rows[0].total)
  const sales = parseInt(salesRow.rows[0].total, 10)
  const { trueProfit, trueRoi } = computeTrueProfit(margin, revenue, cost, sales)

  return {
    period: `last ${days} days (${sinceStr} to ${untilStr})`,
    cost,
    revenue,
    trueProfit,
    roas: cost > 0 ? revenue / cost : null,
    trueRoi,
    leads: parseInt(leadsRow.rows[0].total, 10),
    sales,
  }
}

async function getCampaignBreakdown(clientId: string, days: number, limit: number): Promise<object> {
  const until = new Date()
  const since = new Date(until)
  since.setUTCDate(since.getUTCDate() - (days - 1))
  const sinceStr = since.toISOString().slice(0, 10)
  const untilStr = until.toISOString().slice(0, 10)

  const { rows } = await db.query<{
    campaign_name: string | null
    platform: string
    cost: string
    revenue: string
  }>(
    `SELECT campaign_name, platform, SUM(spend) AS cost,
            COALESCE((SELECT SUM(a.attributed_revenue) FROM attributions a
                      JOIN sessions s ON s.id = a.session_id JOIN purchases p ON p.id = a.purchase_id
                      WHERE a.client_id = ac.client_id AND p.purchased_at::date BETWEEN $2 AND $3
                        -- A client's ad URLs can carry Meta's raw {{campaign.id}} in
                        -- utm_campaign instead of the name (confirmed live) - match on either.
                        AND (LOWER(TRIM(s.utm_campaign)) = LOWER(TRIM(ac.campaign_name)) OR s.utm_campaign = ac.campaign_id)), 0) AS revenue
     FROM ad_costs ac
     WHERE client_id = $1 AND date BETWEEN $2 AND $3 AND campaign_name IS NOT NULL
     GROUP BY campaign_name, platform, client_id
     ORDER BY SUM(spend) DESC
     LIMIT $4`,
    [clientId, sinceStr, untilStr, limit]
  )

  return {
    period: `last ${days} days`,
    campaigns: rows.map((r) => {
      const cost = parseFloat(r.cost)
      const revenue = parseFloat(r.revenue)
      return { campaignName: r.campaign_name, platform: r.platform, cost, revenue, roas: cost > 0 ? revenue / cost : null }
    }),
  }
}

async function getLtvSummary(clientId: string): Promise<object> {
  const { rows } = await db.query<{ campaign: string | null; avg_lifetime: string; customers: string }>(
    `SELECT acquisition_campaign AS campaign, AVG(revenue_lifetime) AS avg_lifetime, COUNT(*) AS customers
     FROM customer_ltv WHERE client_id = $1 GROUP BY acquisition_campaign ORDER BY AVG(revenue_lifetime) DESC LIMIT 10`,
    [clientId]
  )
  return {
    campaigns: rows.map((r) => ({
      campaign: r.campaign ?? '(unknown)',
      avgLifetimeValue: parseFloat(r.avg_lifetime),
      customers: parseInt(r.customers, 10),
    })),
  }
}

async function getBudgetPacingSummary(clientId: string): Promise<object> {
  const { rows: clientRows } = await db.query<{ monthly_budget_target: string | null }>(
    `SELECT monthly_budget_target FROM clients WHERE id = $1`,
    [clientId]
  )
  const target = clientRows[0]?.monthly_budget_target ? parseFloat(clientRows[0].monthly_budget_target) : null
  if (target === null) return { hasBudgetTarget: false }

  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const { rows: spendRows } = await db.query<{ total: string }>(
    `SELECT COALESCE(SUM(spend),0) AS total FROM ad_costs WHERE client_id=$1 AND date >= $2`,
    [clientId, monthStart.toISOString().slice(0, 10)]
  )
  return { hasBudgetTarget: true, monthlyTarget: target, spendToDateThisMonth: parseFloat(spendRows[0].total) }
}

async function getForecastSummary(clientId: string): Promise<object> {
  const until = new Date()
  const since = new Date(until)
  since.setUTCDate(since.getUTCDate() - 59)
  const sinceStr = since.toISOString().slice(0, 10)
  const untilStr = until.toISOString().slice(0, 10)

  const [costByDay, revenueByDay] = await Promise.all([
    db.query<{ date: string; total: string }>(
      `SELECT date::text, SUM(spend) AS total FROM ad_costs WHERE client_id=$1 AND date BETWEEN $2 AND $3 GROUP BY date`,
      [clientId, sinceStr, untilStr]
    ),
    db.query<{ date: string; total: string }>(
      `SELECT p.purchased_at::date::text AS date, SUM(a.attributed_revenue) AS total
       FROM attributions a JOIN purchases p ON p.id=a.purchase_id
       WHERE a.client_id=$1 AND p.purchased_at::date BETWEEN $2 AND $3 GROUP BY p.purchased_at::date`,
      [clientId, sinceStr, untilStr]
    ),
  ])
  const costMap = new Map(costByDay.rows.map((r) => [r.date, parseFloat(r.total)]))
  const revenueMap = new Map(revenueByDay.rows.map((r) => [r.date, parseFloat(r.total)]))
  const dailyCost: number[] = []
  const dailyRevenue: number[] = []
  for (let d = new Date(since); d <= until; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10)
    dailyCost.push(costMap.get(key) ?? 0)
    dailyRevenue.push(revenueMap.get(key) ?? 0)
  }
  return {
    next7Days: { projectedCost: projectSum(dailyCost, 7), projectedRevenue: projectSum(dailyRevenue, 7) },
    next30Days: { projectedCost: projectSum(dailyCost, 30), projectedRevenue: projectSum(dailyRevenue, 30) },
  }
}

export const CHAT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_overview_metrics',
    description: "Get account-wide cost, revenue, profit, ROAS, ROI, leads, and sales for a trailing period.",
    input_schema: {
      type: 'object',
      properties: { days: { type: 'number', description: 'How many trailing days, e.g. 7, 30, 90' } },
      required: ['days'],
    },
  },
  {
    name: 'get_campaign_breakdown',
    description: 'Get the top campaigns by spend, with cost/revenue/ROAS for each, over a trailing period.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'How many trailing days' },
        limit: { type: 'number', description: 'How many top campaigns to return, e.g. 5 or 10' },
      },
      required: ['days', 'limit'],
    },
  },
  {
    name: 'get_ltv_summary',
    description: 'Get average customer lifetime value grouped by acquisition campaign, across all history.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_budget_pacing',
    description: "Get this client's current monthly budget target and spend-to-date this month, if a target is set.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_forecast',
    description: 'Get a simple linear-trend forecast of cost/revenue for the next 7 and 30 days.',
    input_schema: { type: 'object', properties: {} },
  },
]

export async function executeTool(clientId: string, toolName: string, input: Record<string, unknown>): Promise<object> {
  switch (toolName) {
    case 'get_overview_metrics':
      return getOverviewMetrics(clientId, Number(input.days) || 30)
    case 'get_campaign_breakdown':
      return getCampaignBreakdown(clientId, Number(input.days) || 30, Number(input.limit) || 10)
    case 'get_ltv_summary':
      return getLtvSummary(clientId)
    case 'get_budget_pacing':
      return getBudgetPacingSummary(clientId)
    case 'get_forecast':
      return getForecastSummary(clientId)
    default:
      return { error: `Unknown tool: ${toolName}` }
  }
}
