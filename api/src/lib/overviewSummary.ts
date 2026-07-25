import { db } from '../db'
import { computeTrueProfit, MarginConfig } from './margin'

export interface OverviewSummary {
  cost: number
  // Total revenue from every non-refunded purchase, attributed or not — organic/
  // direct sales and anything imported with no matching session (e.g. the
  // historical CSV backfill) count here same as an ad-attributed sale.
  revenue: number
  // Revenue from purchases with at least one ad-click/session match — the only
  // revenue actually caused by ad spend, so this (not the total above) is what
  // ROAS/ROI are measured against. Purely attribution accounting, never a
  // second/duplicate revenue figure to add to `revenue`.
  attributedRevenue: number
  profit: number
  roas: number | null
  roi: number | null
  // Total revenue / total ad spend — "Blended ROAS" (2026-07-25). Deliberately
  // separate from `roas`: this trusts the store's real revenue over Meta/Google's
  // own attribution, but it's an account-wide-only number — mixes in every
  // revenue source (organic, email, direct), so it can't be broken down per
  // campaign/creative the way attributed ROAS can. Both are legitimate, they
  // answer different questions.
  blendedRoas: number | null
  trueProfit: number
  trueRoi: number | null
  leads: number
  sales: number
  // How many of `sales` actually have a matched ad-click/session, and what
  // percent that is (2026-07-25) — the tracking-health question this app kept
  // needing to answer by hand (a real live incident: Nothing But Buckets
  // showing 8 attributed when 16 real orders existed traced to a checkout
  // identify-vs-webhook race). Surfacing it as its own number means a
  // dropping rate shows up immediately instead of only being noticed when
  // someone manually compares two counts.
  attributedSales: number
  attributionRate: number | null
}

// Extracted out of the `/reports/overview` route (Step 57) so the scheduled
// report email job can reuse the exact same cost/revenue/profit/ROAS numbers a
// client would see on their own Overview page, instead of a second hand-written
// copy of this SQL that could quietly drift out of sync with it. The route keeps
// its own day-by-day series queries — the email only needs the totals.
//
// `revenue`/`profit`/`trueProfit` are whole-business figures (every non-refunded
// sale) — split out from `attributedRevenue` (2026-07-24) after a historical CSV
// backfill made it obvious that gating the headline Revenue tile on attribution
// alone hid real, confirmed sales that just had no matching tracked session.
// ROAS/ROI stay attribution-based on purpose: they measure ad spend's return,
// and unattributed revenue wasn't caused by that spend.
export async function getOverviewSummary(clientId: string, from: string, to: string): Promise<OverviewSummary> {
  const [marginConfig, costTotal, revenueTotal, attributedRevenueTotal, leadsTotal, salesTotal, attributedSalesTotal] = await Promise.all([
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
      `SELECT COALESCE(SUM(revenue), 0) AS total FROM purchases
       WHERE client_id = $1 AND purchased_at::date BETWEEN $2 AND $3 AND NOT refunded`,
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
    db.query<{ total: string }>(
      `SELECT COUNT(DISTINCT a.purchase_id) AS total
       FROM attributions a JOIN purchases p ON p.id = a.purchase_id
       WHERE a.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3 AND NOT p.refunded`,
      [clientId, from, to]
    ),
  ])

  const cost = parseFloat(costTotal.rows[0].total)
  const revenue = parseFloat(revenueTotal.rows[0].total)
  const attributedRevenue = parseFloat(attributedRevenueTotal.rows[0].total)
  const sales = parseInt(salesTotal.rows[0].total, 10)
  const profit = revenue - cost
  const roas = cost > 0 ? attributedRevenue / cost : null
  const blendedRoas = cost > 0 ? revenue / cost : null
  const roi = cost > 0 ? ((attributedRevenue - cost) / cost) * 100 : null
  const margin = marginConfig.rows[0] ?? null
  // Two separate COGS/fee/fulfillment adjustments, deliberately not one shared
  // call: trueProfit pairs with the total-revenue `profit` tile (whole-business
  // number), trueRoi pairs with `roi`/`roas` (ad-spend-only, attributed revenue) —
  // computeTrueProfit against the wrong revenue figure would silently blend the
  // two groups back together.
  const { trueProfit } = computeTrueProfit(margin, revenue, cost, sales)
  const { trueRoi } = computeTrueProfit(margin, attributedRevenue, cost, sales)
  const attributedSales = parseInt(attributedSalesTotal.rows[0].total, 10)
  const attributionRate = sales > 0 ? (attributedSales / sales) * 100 : null

  return {
    cost,
    revenue,
    attributedRevenue,
    profit,
    roas,
    blendedRoas,
    roi,
    trueProfit,
    trueRoi,
    leads: parseInt(leadsTotal.rows[0].total, 10),
    sales,
    attributedSales,
    attributionRate,
  }
}
