import { db } from '../db'

// A side-by-side first-touch vs last-touch revenue comparison, per campaign —
// deliberately NOT read from the `attributions` table. That table only ever
// holds rows for whichever single model was active on the client at the
// moment each purchase happened (see recordPurchase in attribution.ts), so a
// client running on `last_click` has no first-touch numbers to read back for
// past purchases, and vice versa. Recomputed here straight from raw
// sessions/purchases instead — same 90-day lookback window recordPurchase
// itself uses — so both models are always available for any historical
// range, independent of whichever model happens to be configured right now.
export interface AttributionComparisonRow {
  name: string
  firstTouchRevenue: number
  firstTouchSales: number
  lastTouchRevenue: number
  lastTouchSales: number
}

interface PurchaseTouches {
  purchase_id: string
  revenue: string
  first_campaign: string | null
  last_campaign: string | null
}

const UNNAMED = '(no campaign)'

export async function computeAttributionComparison(
  clientId: string,
  from: string,
  to: string
): Promise<AttributionComparisonRow[]> {
  const { rows } = await db.query<PurchaseTouches>(
    `SELECT p.id AS purchase_id, p.revenue, fs.utm_campaign AS first_campaign, ls.utm_campaign AS last_campaign
     FROM purchases p
     JOIN identities i ON i.client_id = p.client_id AND i.email = p.email
     JOIN LATERAL (
       SELECT utm_campaign FROM sessions
       WHERE visitor_id = i.visitor_id AND started_at <= p.purchased_at AND started_at >= p.purchased_at - INTERVAL '90 days'
       ORDER BY started_at ASC LIMIT 1
     ) fs ON true
     JOIN LATERAL (
       SELECT utm_campaign FROM sessions
       WHERE visitor_id = i.visitor_id AND started_at <= p.purchased_at AND started_at >= p.purchased_at - INTERVAL '90 days'
       ORDER BY started_at DESC LIMIT 1
     ) ls ON true
     WHERE p.client_id = $1 AND NOT p.refunded AND p.purchased_at::date BETWEEN $2 AND $3`,
    [clientId, from, to]
  )

  const byName = new Map<string, AttributionComparisonRow>()
  const get = (name: string): AttributionComparisonRow => {
    let row = byName.get(name)
    if (!row) {
      row = { name, firstTouchRevenue: 0, firstTouchSales: 0, lastTouchRevenue: 0, lastTouchSales: 0 }
      byName.set(name, row)
    }
    return row
  }

  for (const r of rows) {
    const revenue = parseFloat(r.revenue)
    const firstRow = get(r.first_campaign ?? UNNAMED)
    firstRow.firstTouchRevenue += revenue
    firstRow.firstTouchSales += 1
    const lastRow = get(r.last_campaign ?? UNNAMED)
    lastRow.lastTouchRevenue += revenue
    lastRow.lastTouchSales += 1
  }

  return [...byName.values()].sort(
    (a, b) => b.firstTouchRevenue + b.lastTouchRevenue - (a.firstTouchRevenue + a.lastTouchRevenue)
  )
}
