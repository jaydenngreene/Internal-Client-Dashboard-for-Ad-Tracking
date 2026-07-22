import { db } from '../db'
import { computeTrueProfit, MarginConfig } from './margin'

export interface OverviewSummary {
  cost: number
  revenue: number
  profit: number
  roas: number | null
  roi: number | null
  trueProfit: number
  trueRoi: number | null
  leads: number
  sales: number
}

// Extracted out of the `/reports/overview` route (Step 57) so the scheduled
// report email job can reuse the exact same cost/revenue/profit/ROAS numbers a
// client would see on their own Overview page, instead of a second hand-written
// copy of this SQL that could quietly drift out of sync with it. The route keeps
// its own day-by-day series queries — the email only needs the totals.
export async function getOverviewSummary(clientId: string, from: string, to: string): Promise<OverviewSummary> {
  const [marginConfig, costTotal, revenueTotal, leadsTotal, salesTotal] = await Promise.all([
    db.query<MarginConfig>(
      `SELECT cogs_percent, payment_fee_percent, fulfillment_cost_flat FROM clients WHERE id = $1`,
      [clientId]
    ),
    db.query<{ total: string }>(
      `SELECT
         (SELECT COALESCE(SUM(spend), 0) FROM ad_costs WHERE client_id = $1 AND date BETWEEN $2 AND $3) +
         (SELECT COALESCE(SUM(spend), 0) FROM custom_costs WHERE client_id = $1 AND date BETWEEN $2 AND $3)
         AS total`,
      [clientId, from, to]
    ),
    db.query<{ total: string }>(
      `SELECT COALESCE(SUM(a.attributed_revenue), 0) AS total
       FROM attributions a JOIN purchases p ON p.id = a.purchase_id
       WHERE a.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3`,
      [clientId, from, to]
    ),
    db.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM leads WHERE client_id = $1 AND created_at::date BETWEEN $2 AND $3`,
      [clientId, from, to]
    ),
    db.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM purchases
       WHERE client_id = $1 AND purchased_at::date BETWEEN $2 AND $3 AND NOT refunded`,
      [clientId, from, to]
    ),
  ])

  const cost = parseFloat(costTotal.rows[0].total)
  const revenue = parseFloat(revenueTotal.rows[0].total)
  const sales = parseInt(salesTotal.rows[0].total, 10)
  const profit = revenue - cost
  const roas = cost > 0 ? revenue / cost : null
  const roi = cost > 0 ? (profit / cost) * 100 : null
  const margin = marginConfig.rows[0] ?? null
  const { trueProfit, trueRoi } = computeTrueProfit(margin, revenue, cost, sales)

  return {
    cost,
    revenue,
    profit,
    roas,
    roi,
    trueProfit,
    trueRoi,
    leads: parseInt(leadsTotal.rows[0].total, 10),
    sales,
  }
}
