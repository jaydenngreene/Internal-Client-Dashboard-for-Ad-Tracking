import Anthropic from '@anthropic-ai/sdk'
import { db } from '../db'
import { computeTrueProfit, MarginConfig } from './margin'
import { projectSum } from './forecasting'
import { getCostContext, getDaysLiveMap, lookupDaysLive, annotateEntityGate } from './recommendationGate'

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
    campaign_id: string | null
    platform: string
    cost: string
    revenue: string
    sales: string
  }>(
    `SELECT campaign_name, campaign_id, platform, SUM(spend) AS cost,
            COALESCE((SELECT SUM(a.attributed_revenue) FROM attributions a
                      JOIN sessions s ON s.id = a.session_id JOIN purchases p ON p.id = a.purchase_id
                      WHERE a.client_id = ac.client_id AND p.purchased_at::date BETWEEN $2 AND $3
                        -- A client's ad URLs can carry Meta's raw {{campaign.id}} in
                        -- utm_campaign instead of the name (confirmed live) - match on either.
                        AND (LOWER(TRIM(s.utm_campaign)) = LOWER(TRIM(ac.campaign_name)) OR s.utm_campaign = ac.campaign_id)), 0) AS revenue,
            COALESCE((SELECT COUNT(DISTINCT a.purchase_id) FROM attributions a
                      JOIN sessions s ON s.id = a.session_id JOIN purchases p ON p.id = a.purchase_id
                      WHERE a.client_id = ac.client_id AND p.purchased_at::date BETWEEN $2 AND $3
                        AND (LOWER(TRIM(s.utm_campaign)) = LOWER(TRIM(ac.campaign_name)) OR s.utm_campaign = ac.campaign_id)), 0) AS sales
     FROM ad_costs ac
     WHERE client_id = $1 AND date BETWEEN $2 AND $3 AND campaign_name IS NOT NULL
     -- campaign_id must be a GROUP BY key (not MAX()'d) so the correlated
     -- subqueries above can reference ac.campaign_id validly — same grouping
     -- shape insightsAgent.ts's equivalent queries already use.
     GROUP BY campaign_name, campaign_id, platform, client_id
     ORDER BY SUM(spend) DESC
     LIMIT $4`,
    [clientId, sinceStr, untilStr, limit]
  )

  // Review fix (2026-07-28, item 2): Gojo (the chat) previously had zero
  // awareness of data sufficiency — every campaign row it could see was fair
  // game for a "this is underperforming, pause it" style judgment regardless
  // of how new or under-spent it was. Same gate, same annotation shape as
  // insightsAgent.ts's whole-account/platform rows; chatAgent.ts's system
  // prompt is the enforcement layer here (there's no post-validation step for
  // chat the way there is for Insights, since a chat answer is conversational
  // prose, not a list of discrete recommendation objects to filter).
  const [costCtx, daysLiveMap] = await Promise.all([getCostContext(clientId), getDaysLiveMap(clientId, 'campaign')])

  return {
    period: `last ${days} days`,
    campaigns: rows.map((r) => {
      const cost = parseFloat(r.cost)
      const revenue = parseFloat(r.revenue)
      const sales = parseInt(r.sales, 10)
      return {
        campaignName: r.campaign_name,
        platform: r.platform,
        cost,
        revenue,
        roas: cost > 0 ? revenue / cost : null,
        ...annotateEntityGate(costCtx, 'campaign', lookupDaysLive(daysLiveMap, r.campaign_id, r.campaign_name), cost, sales),
      }
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

// Review fix (2026-07-28, item 2): before this, asked "is this creative
// fatiguing," Gojo had no tool that could see Kado's creative-fatigue verdict
// at all and had to improvise an answer from account-level aggregates. This
// reads Kado's own deterministic output directly (creative_fatigue_signals,
// the same table creativeFatigue/run.ts writes and the Creative Fatigue page
// reads) so the chat reports a real verdict instead of inventing one.
async function getCreativeFatigueSignals(clientId: string): Promise<object> {
  const { rows } = await db.query<{
    ad_name: string | null
    campaign_name: string | null
    platform: string
    days_live: number | null
    confidence: string | null
    metrics_triggered: Record<string, { recentShort: number | null; priorShort: number | null; triggered: boolean }> | null
    created_at: string
  }>(
    `SELECT ad_name, campaign_name, platform, days_live, confidence, metrics_triggered, created_at
     FROM creative_fatigue_signals WHERE client_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 20`,
    [clientId]
  )
  return {
    activeSignals: rows.map((r) => ({
      adName: r.ad_name,
      campaignName: r.campaign_name,
      platform: r.platform,
      daysLive: r.days_live,
      confidence: r.confidence,
      flaggedAt: r.created_at,
      triggeringMetrics: r.metrics_triggered
        ? Object.entries(r.metrics_triggered)
            .filter(([, m]) => m.triggered)
            .map(([metric, m]) => ({ metric, recent: m.recentShort, prior: m.priorShort }))
        : [],
    })),
  }
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
    name: 'get_creative_fatigue_signals',
    description:
      "Get Kado's own creative-fatigue verdicts: which creatives are currently flagged as declining (sustained drop in ROAS/CTR/CPA, corroborated by CPM/frequency), with days live, confidence, and the actual metric numbers that triggered each flag. Use this instead of guessing from aggregates when asked whether a specific creative is fatiguing or declining.",
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
    case 'get_creative_fatigue_signals':
      return getCreativeFatigueSignals(clientId)
    case 'get_budget_pacing':
      return getBudgetPacingSummary(clientId)
    case 'get_forecast':
      return getForecastSummary(clientId)
    default:
      return { error: `Unknown tool: ${toolName}` }
  }
}
