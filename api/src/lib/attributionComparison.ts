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
  // Null when no ad_costs row could resolve this touch to a real campaign
  // (name is then just the raw utm_campaign, or '(no campaign)') — the
  // dashboard uses this to decide whether the row can link anywhere.
  platform: string | null
  firstTouchRevenue: number
  firstTouchSales: number
  lastTouchRevenue: number
  lastTouchSales: number
}

interface PurchaseTouches {
  purchase_id: string
  revenue: string
  first_utm_campaign: string | null
  first_campaign_name: string | null
  first_platform: string | null
  last_utm_campaign: string | null
  last_campaign_name: string | null
  last_platform: string | null
}

const UNNAMED = '(no campaign)'

// Same id-or-name matching convention every other report in this app already
// uses (see buyingJourney.ts's AD_COSTS_MATCH_LATERAL for the creative-level
// equivalent) — utm_campaign is frequently the ad platform's raw numeric
// campaign id rather than a human name, so a plain display of utm_campaign
// alone is often unreadable. Resolving it against ad_costs also recovers the
// platform, needed to link a row to the existing campaign detail page.
function campaignResolutionLateral(alias: string, sessionAlias: string): string {
  return `
  LEFT JOIN LATERAL (
    SELECT campaign_name, platform FROM ad_costs
    WHERE client_id = p.client_id
      AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE(COALESCE(${sessionAlias}.utm_source, ''), '_ads$', ''))
      AND (campaign_id = ${sessionAlias}.utm_campaign OR LOWER(TRIM(campaign_name)) = LOWER(TRIM(${sessionAlias}.utm_campaign)))
    LIMIT 1
  ) ${alias} ON ${sessionAlias}.utm_campaign IS NOT NULL`
}

export async function computeAttributionComparison(
  clientId: string,
  from: string,
  to: string
): Promise<AttributionComparisonRow[]> {
  const { rows } = await db.query<PurchaseTouches>(
    `SELECT p.id AS purchase_id, p.revenue,
       fs.utm_campaign AS first_utm_campaign, fs_ac.campaign_name AS first_campaign_name, fs_ac.platform AS first_platform,
       ls.utm_campaign AS last_utm_campaign, ls_ac.campaign_name AS last_campaign_name, ls_ac.platform AS last_platform
     FROM purchases p
     JOIN identities i ON i.client_id = p.client_id AND i.email = p.email
     JOIN LATERAL (
       SELECT utm_campaign, utm_source FROM sessions
       WHERE visitor_id = i.visitor_id AND started_at <= p.purchased_at AND started_at >= p.purchased_at - INTERVAL '90 days'
       ORDER BY started_at ASC LIMIT 1
     ) fs ON true
     ${campaignResolutionLateral('fs_ac', 'fs')}
     JOIN LATERAL (
       SELECT utm_campaign, utm_source FROM sessions
       WHERE visitor_id = i.visitor_id AND started_at <= p.purchased_at AND started_at >= p.purchased_at - INTERVAL '90 days'
       ORDER BY started_at DESC LIMIT 1
     ) ls ON true
     ${campaignResolutionLateral('ls_ac', 'ls')}
     WHERE p.client_id = $1 AND NOT p.refunded AND p.purchased_at::date BETWEEN $2 AND $3`,
    [clientId, from, to]
  )

  const byKey = new Map<string, AttributionComparisonRow>()
  // Keyed by name+platform, not name alone - the same campaign name can exist
  // on two different platforms (Facebook AND Google both running "Summer
  // Sale"), and collapsing those into one row would silently blend their
  // numbers together.
  const get = (name: string, platform: string | null): AttributionComparisonRow => {
    const key = `${name}::${platform ?? ''}`
    let row = byKey.get(key)
    if (!row) {
      row = { name, platform, firstTouchRevenue: 0, firstTouchSales: 0, lastTouchRevenue: 0, lastTouchSales: 0 }
      byKey.set(key, row)
    }
    return row
  }

  for (const r of rows) {
    const revenue = parseFloat(r.revenue)
    const firstRow = get(r.first_campaign_name ?? r.first_utm_campaign ?? UNNAMED, r.first_campaign_name ? r.first_platform : null)
    firstRow.firstTouchRevenue += revenue
    firstRow.firstTouchSales += 1
    const lastRow = get(r.last_campaign_name ?? r.last_utm_campaign ?? UNNAMED, r.last_campaign_name ? r.last_platform : null)
    lastRow.lastTouchRevenue += revenue
    lastRow.lastTouchSales += 1
  }

  return [...byKey.values()].sort(
    (a, b) => b.firstTouchRevenue + b.lastTouchRevenue - (a.firstTouchRevenue + a.lastTouchRevenue)
  )
}
