import { db } from '../db'

// Phase 2 (2026-07-28) — "Customer Buying Journey" tab, ecom clients only.
// Two things live here: the page-level summary metrics (2.1) and the
// "Customers Who Purchased" tab's data (2.3). Kept as one computed payload
// (like overviewSummary.ts's single-fetch pattern) since the frontend page
// needs both at once rather than issuing separate round-trips.

export interface TopConvertingCreative {
  name: string
  customers: number
}

export interface PurchasingCustomer {
  email: string
  totalSpent: number
  // null when this customer was never tracked by the pixel (no identity/
  // session history) — same "flagged, not silently hidden" reasoning
  // journey.ts already uses for an untracked lead's purchases.
  sessionsToConvert: number | null
}

export interface BuyingJourneySummary {
  avgDaysToConvert: number | null
  avgSessionsToConvert: number | null
  topConvertingCreatives: TopConvertingCreative[]
  customers: PurchasingCustomer[]
}

interface FirstPurchaseRow {
  email: string
  purchased_at: string
  visitor_id: string | null
}

export async function computeBuyingJourneySummary(clientId: string, from: string, to: string): Promise<BuyingJourneySummary> {
  // One row per customer's FIRST purchase in [from, to] — the "conversion
  // moment" days-to-convert/sessions-to-convert are measured against. A
  // repeat purchase by the same customer later in the same window doesn't
  // get counted again for these two per-customer metrics.
  const { rows: firstPurchases } = await db.query<FirstPurchaseRow>(
    `SELECT DISTINCT ON (p.email) p.email, p.purchased_at, i.visitor_id
     FROM purchases p
     LEFT JOIN identities i ON i.client_id = p.client_id AND i.email = p.email
     WHERE p.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3 AND NOT p.refunded
     ORDER BY p.email, p.purchased_at ASC`,
    [clientId, from, to]
  )

  if (firstPurchases.length === 0) {
    return { avgDaysToConvert: null, avgSessionsToConvert: null, topConvertingCreatives: [], customers: [] }
  }

  const emails = firstPurchases.map((r) => r.email)

  // Total spend per customer across ALL their purchases in the window (not
  // just the first) — a repeat buyer's total should reflect everything they
  // bought in range, even though days/sessions-to-convert only look at their
  // first purchase.
  const { rows: totalsRows } = await db.query<{ email: string; total: string }>(
    `SELECT email, SUM(revenue) AS total FROM purchases
     WHERE client_id = $1 AND purchased_at::date BETWEEN $2 AND $3 AND NOT refunded AND email = ANY($4::text[])
     GROUP BY email`,
    [clientId, from, to, emails]
  )
  const totalsMap = new Map(totalsRows.map((r) => [r.email, parseFloat(r.total)]))

  // Per-customer days/sessions-to-convert — looped rather than one clever
  // query, matching this codebase's existing convention for moderate-
  // cardinality per-entity work (e.g. jobs/costPerPurchase, jobs/adCosts each
  // loop per client/ad with awaited queries inside). Untracked customers (no
  // identity, so no visitor_id) are skipped — there's no session history to
  // measure against.
  const daysToConvertByEmail = new Map<string, number>()
  const sessionsToConvertByEmail = new Map<string, number>()
  for (const fp of firstPurchases) {
    if (!fp.visitor_id) continue
    const { rows: firstSessionRows } = await db.query<{ first_session_at: string | null }>(
      `SELECT MIN(started_at) AS first_session_at FROM sessions WHERE visitor_id = $1`,
      [fp.visitor_id]
    )
    const firstSessionAt = firstSessionRows[0]?.first_session_at
    if (!firstSessionAt) continue
    const daysToConvert = (new Date(fp.purchased_at).getTime() - new Date(firstSessionAt).getTime()) / 86400000
    // A purchase can't precede this visitor's first-ever tracked session —
    // when it looks like it does, it means identity-linking resolved this
    // email to a visitor_id whose only real session history came AFTER the
    // purchase (this app's known identify()-at-checkout gaps mean a large
    // share of real orders have zero session/identity at purchase time —
    // see docs/ISSUE_LOG.md — and a later touch, e.g. a marketing-email
    // click, is what created the identity link). That's not a real
    // days-to-convert, it's a tracking-gap artifact — excluded the same way
    // a fully untracked purchase already is, not averaged in as if genuine.
    if (daysToConvert < 0) continue
    const { rows: sessionCountRows } = await db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM sessions WHERE visitor_id = $1 AND started_at <= $2`,
      [fp.visitor_id, fp.purchased_at]
    )
    daysToConvertByEmail.set(fp.email, daysToConvert)
    sessionsToConvertByEmail.set(fp.email, parseInt(sessionCountRows[0].count, 10))
  }

  const trackedDays = [...daysToConvertByEmail.values()]
  const trackedSessions = [...sessionsToConvertByEmail.values()]
  const avgDaysToConvert = trackedDays.length > 0 ? trackedDays.reduce((a, b) => a + b, 0) / trackedDays.length : null
  const avgSessionsToConvert = trackedSessions.length > 0 ? trackedSessions.reduce((a, b) => a + b, 0) / trackedSessions.length : null

  // Top 3 creatives by distinct converting customers — every attributed
  // purchase in range counts (not just each customer's first), same
  // ad_costs id-or-name resolution convention used throughout this app so
  // the name shown is the real creative, not the raw numeric utm_content id.
  const { rows: creativeRows } = await db.query<{ creative_name: string; customers: string }>(
    `SELECT COALESCE(ac.ad_name, s.utm_content) AS creative_name, COUNT(DISTINCT p.email) AS customers
     FROM purchases p
     JOIN attributions a ON a.purchase_id = p.id AND a.client_id = p.client_id
     JOIN sessions s ON s.id = a.session_id
     LEFT JOIN LATERAL (
       SELECT ad_name FROM ad_costs
       WHERE client_id = p.client_id
         AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE(COALESCE(s.utm_source, ''), '_ads$', ''))
         AND (ad_id = s.utm_content OR LOWER(TRIM(ad_name)) = LOWER(TRIM(s.utm_content)))
       LIMIT 1
     ) ac ON s.utm_content IS NOT NULL
     WHERE p.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3 AND NOT p.refunded AND s.utm_content IS NOT NULL
     GROUP BY COALESCE(ac.ad_name, s.utm_content)
     ORDER BY COUNT(DISTINCT p.email) DESC
     LIMIT 3`,
    [clientId, from, to]
  )

  return {
    avgDaysToConvert,
    avgSessionsToConvert,
    topConvertingCreatives: creativeRows.map((r) => ({ name: r.creative_name, customers: parseInt(r.customers, 10) })),
    customers: firstPurchases.map((fp) => ({
      email: fp.email,
      totalSpent: totalsMap.get(fp.email) ?? 0,
      sessionsToConvert: sessionsToConvertByEmail.get(fp.email) ?? null,
    })),
  }
}
