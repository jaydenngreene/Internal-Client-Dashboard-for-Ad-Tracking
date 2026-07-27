import { db } from '../db'
import { conversionConfigForNiche, ConversionEventType } from '../config/nicheVocabulary'

// Phase 3 (2026-07-28) — generalizes Phase 2's ecom-only "Customer Buying
// Journey" summary to every niche. One shared computation
// (computeBuyingJourneySummary) driven entirely by which event type the
// client's niche maps to (nicheVocabulary.ts) — the per-niche differences
// live ONLY in the four small per-event-type fetchers below, never in the
// aggregation logic itself.

export interface TopConvertingCreative {
  name: string
  customers: number
}

export interface ConvertedPerson {
  // Email for every event type except a qualified call that was never linked
  // to an identified visitor (a pure phone-only lead, no email ever
  // captured) — falls back to the caller's phone number in that case rather
  // than silently dropping the row. Same "flagged, not hidden" reasoning
  // this app already applies to unattributed purchases.
  identifier: string
  conversionCount: number
  totalValue: number | null
  sessionsToConvert: number | null
}

export interface BuyingJourneySummary {
  eventType: ConversionEventType
  hasValue: boolean
  avgDaysToConvert: number | null
  avgSessionsToConvert: number | null
  topConvertingCreatives: TopConvertingCreative[]
  people: ConvertedPerson[]
}

interface RawEvent {
  identifier: string
  visitorId: string | null
  occurredAt: string
  value: number | null
}

interface CreativeAttribution {
  identifier: string
  creativeName: string
}

const AD_COSTS_MATCH_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT ad_name FROM ad_costs
    WHERE client_id = s.client_id
      AND LOWER(REGEXP_REPLACE(platform, '_ads$', '')) = LOWER(REGEXP_REPLACE(COALESCE(s.utm_source, ''), '_ads$', ''))
      AND (ad_id = s.utm_content OR LOWER(TRIM(ad_name)) = LOWER(TRIM(s.utm_content)))
    LIMIT 1
  ) ac ON s.utm_content IS NOT NULL
`

// ---- Purchase (ecommerce, info_product) ----

async function getPurchaseEvents(clientId: string, from: string, to: string): Promise<RawEvent[]> {
  const { rows } = await db.query<{ identifier: string; visitor_id: string | null; occurred_at: string; value: string }>(
    `SELECT p.email AS identifier, i.visitor_id, p.purchased_at AS occurred_at, p.revenue AS value
     FROM purchases p
     LEFT JOIN identities i ON i.client_id = p.client_id AND i.email = p.email
     WHERE p.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3 AND NOT p.refunded`,
    [clientId, from, to]
  )
  return rows.map((r) => ({ identifier: r.identifier, visitorId: r.visitor_id, occurredAt: r.occurred_at, value: parseFloat(r.value) }))
}

// Real attribution rows (from recordPurchase, honoring whichever attribution
// model the client uses) — a linear-model purchase can produce more than one
// row here, which is correct: a person whose credit split across two
// creatives should count toward both creatives' distinct-converter tallies,
// same characteristic Phase 2's original top-creatives query already had.
async function getPurchaseCreativeAttributions(clientId: string, from: string, to: string): Promise<CreativeAttribution[]> {
  const { rows } = await db.query<{ identifier: string; creative_name: string }>(
    `SELECT p.email AS identifier, COALESCE(ac.ad_name, s.utm_content) AS creative_name
     FROM purchases p
     JOIN attributions a ON a.purchase_id = p.id AND a.client_id = p.client_id
     JOIN sessions s ON s.id = a.session_id
     ${AD_COSTS_MATCH_LATERAL}
     WHERE p.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3 AND NOT p.refunded AND s.utm_content IS NOT NULL`,
    [clientId, from, to]
  )
  return rows.map((r) => ({ identifier: r.identifier, creativeName: r.creative_name }))
}

// ---- Lead (lead_gen, other) ----

async function getLeadEvents(clientId: string, from: string, to: string): Promise<RawEvent[]> {
  const { rows } = await db.query<{ identifier: string; visitor_id: string | null; occurred_at: string }>(
    `SELECT l.email AS identifier, i.visitor_id, l.created_at AS occurred_at
     FROM leads l
     LEFT JOIN identities i ON i.client_id = l.client_id AND i.email = l.email
     WHERE l.client_id = $1 AND l.created_at::date BETWEEN $2 AND $3`,
    [clientId, from, to]
  )
  return rows.map((r) => ({ identifier: r.identifier, visitorId: r.visitor_id, occurredAt: r.occurred_at, value: null }))
}

// No `attributions` table row exists for a lead — that mechanism is
// purchase-only. Resolved instead via the same "nearest preceding session,
// first-touch, 90-day window" convention insightsAgent.ts's own lead
// attribution already uses, so this doesn't disagree with how leads are
// attributed everywhere else in this app.
async function getLeadCreativeAttributions(clientId: string, from: string, to: string): Promise<CreativeAttribution[]> {
  const { rows } = await db.query<{ identifier: string; creative_name: string }>(
    `SELECT l.email AS identifier, COALESCE(ac.ad_name, s.utm_content) AS creative_name
     FROM leads l
     JOIN identities i ON i.client_id = l.client_id AND i.email = l.email
     JOIN LATERAL (
       SELECT * FROM sessions
       WHERE visitor_id = i.visitor_id AND started_at <= l.created_at AND started_at >= l.created_at - INTERVAL '90 days'
       ORDER BY started_at ASC LIMIT 1
     ) s ON true
     ${AD_COSTS_MATCH_LATERAL}
     WHERE l.client_id = $1 AND l.created_at::date BETWEEN $2 AND $3 AND s.utm_content IS NOT NULL`,
    [clientId, from, to]
  )
  return rows.map((r) => ({ identifier: r.identifier, creativeName: r.creative_name }))
}

// ---- Subscription conversion (saas) ----

async function getSubscriptionEvents(clientId: string, from: string, to: string): Promise<RawEvent[]> {
  const { rows } = await db.query<{ identifier: string | null; visitor_id: string | null; occurred_at: string; value: string }>(
    `SELECT s.email AS identifier, i.visitor_id, se.occurred_at, se.mrr_delta AS value
     FROM subscription_events se
     JOIN subscriptions s ON s.id = se.subscription_id
     LEFT JOIN identities i ON i.client_id = se.client_id AND i.email = s.email
     WHERE se.client_id = $1 AND se.event_type IN ('trial_converted', 'activated')
       AND se.occurred_at::date BETWEEN $2 AND $3`,
    [clientId, from, to]
  )
  // A subscription with no email on file (Stripe webhook backfill gap — see
  // subscriptions.ts) can't be shown as a converted person at all; skipped
  // rather than shown with a blank identifier.
  return rows
    .filter((r): r is typeof r & { identifier: string } => r.identifier !== null)
    .map((r) => ({ identifier: r.identifier, visitorId: r.visitor_id, occurredAt: r.occurred_at, value: parseFloat(r.value) }))
}

async function getSubscriptionCreativeAttributions(clientId: string, from: string, to: string): Promise<CreativeAttribution[]> {
  const { rows } = await db.query<{ identifier: string; creative_name: string }>(
    `SELECT sub.email AS identifier, COALESCE(ac.ad_name, s.utm_content) AS creative_name
     FROM subscription_events se
     JOIN subscriptions sub ON sub.id = se.subscription_id
     JOIN identities i ON i.client_id = se.client_id AND i.email = sub.email
     JOIN LATERAL (
       SELECT * FROM sessions
       WHERE visitor_id = i.visitor_id AND started_at <= se.occurred_at AND started_at >= se.occurred_at - INTERVAL '90 days'
       ORDER BY started_at ASC LIMIT 1
     ) s ON true
     ${AD_COSTS_MATCH_LATERAL}
     WHERE se.client_id = $1 AND se.event_type IN ('trial_converted', 'activated')
       AND se.occurred_at::date BETWEEN $2 AND $3 AND s.utm_content IS NOT NULL`,
    [clientId, from, to]
  )
  return rows.map((r) => ({ identifier: r.identifier, creativeName: r.creative_name }))
}

// ---- Qualified call (call) ----

async function getCallEvents(clientId: string, from: string, to: string): Promise<RawEvent[]> {
  // A call's session_id is a direct FK — no email/identity walk needed to
  // find the visitor, unlike every other event type. Email is still
  // resolved afterward (if that visitor was ever identified) purely for
  // display; a pure phone-only prospect who never submitted an email
  // anywhere falls back to their caller number rather than being dropped.
  const { rows } = await db.query<{
    identifier: string | null
    caller_number: string | null
    visitor_id: string | null
    occurred_at: string
  }>(
    `SELECT i.email AS identifier, c.caller_number, s.visitor_id, c.started_at AS occurred_at
     FROM calls c
     JOIN sessions s ON s.id = c.session_id
     LEFT JOIN identities i ON i.client_id = c.client_id AND i.visitor_id = s.visitor_id
     WHERE c.client_id = $1 AND c.qualified = TRUE AND c.started_at::date BETWEEN $2 AND $3`,
    [clientId, from, to]
  )
  return rows.map((r) => ({
    identifier: r.identifier ?? r.caller_number ?? '(unknown contact)',
    visitorId: r.visitor_id,
    occurredAt: r.occurred_at,
    value: null, // no deal_value field exists on `calls` yet
  }))
}

async function getCallCreativeAttributions(clientId: string, from: string, to: string): Promise<CreativeAttribution[]> {
  const { rows } = await db.query<{ identifier: string | null; caller_number: string | null; creative_name: string }>(
    `SELECT i.email AS identifier, c.caller_number, COALESCE(ac.ad_name, s.utm_content) AS creative_name
     FROM calls c
     JOIN sessions s ON s.id = c.session_id
     LEFT JOIN identities i ON i.client_id = c.client_id AND i.visitor_id = s.visitor_id
     ${AD_COSTS_MATCH_LATERAL}
     WHERE c.client_id = $1 AND c.qualified = TRUE AND c.started_at::date BETWEEN $2 AND $3 AND s.utm_content IS NOT NULL`,
    [clientId, from, to]
  )
  return rows.map((r) => ({ identifier: r.identifier ?? r.caller_number ?? '(unknown contact)', creativeName: r.creative_name }))
}

// ---- Shared aggregation (identical for every niche) ----

// A conversion can't precede this visitor's first-ever tracked session —
// when the math says it does, identity-linking resolved this person to a
// visitor_id whose only real session history came AFTER the conversion
// (this app's well-documented identify()-at-conversion gaps mean a
// meaningful share of real conversions have zero session/identity at the
// moment they happen, on every channel this app tracks — Shopify checkout,
// GoHighLevel form redirects, Stripe webhooks — not just ecom purchases).
// That's not a real days-to-convert, it's a tracking-gap artifact, excluded
// the same way a fully untracked conversion already is.
async function getDaysAndSessionsToConvert(
  visitorId: string,
  occurredAt: string
): Promise<{ daysToConvert: number; sessionsToConvert: number } | null> {
  const { rows: firstSessionRows } = await db.query<{ first_session_at: string | null }>(
    `SELECT MIN(started_at) AS first_session_at FROM sessions WHERE visitor_id = $1`,
    [visitorId]
  )
  const firstSessionAt = firstSessionRows[0]?.first_session_at
  if (!firstSessionAt) return null
  const daysToConvert = (new Date(occurredAt).getTime() - new Date(firstSessionAt).getTime()) / 86400000
  if (daysToConvert < 0) return null
  const { rows: sessionCountRows } = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM sessions WHERE visitor_id = $1 AND started_at <= $2`,
    [visitorId, occurredAt]
  )
  return { daysToConvert, sessionsToConvert: parseInt(sessionCountRows[0].count, 10) }
}

export async function computeBuyingJourneySummary(clientId: string, niche: string, from: string, to: string): Promise<BuyingJourneySummary> {
  const config = conversionConfigForNiche(niche)

  const [events, creativeAttributions] = await (async (): Promise<[RawEvent[], CreativeAttribution[]]> => {
    switch (config.eventType) {
      case 'purchase':
        return Promise.all([getPurchaseEvents(clientId, from, to), getPurchaseCreativeAttributions(clientId, from, to)])
      case 'subscription_conversion':
        return Promise.all([getSubscriptionEvents(clientId, from, to), getSubscriptionCreativeAttributions(clientId, from, to)])
      case 'qualified_call':
        return Promise.all([getCallEvents(clientId, from, to), getCallCreativeAttributions(clientId, from, to)])
      case 'lead':
        return Promise.all([getLeadEvents(clientId, from, to), getLeadCreativeAttributions(clientId, from, to)])
    }
  })()

  if (events.length === 0) {
    return {
      eventType: config.eventType,
      hasValue: config.hasValue,
      avgDaysToConvert: null,
      avgSessionsToConvert: null,
      topConvertingCreatives: [],
      people: [],
    }
  }

  // Never sum different event types into one count — the niche's declared
  // eventType is the only thing driving this tab, so `events` here is
  // homogeneous by construction (exactly one fetcher ran, above).
  const byIdentifier = new Map<string, RawEvent[]>()
  for (const e of events) {
    if (!byIdentifier.has(e.identifier)) byIdentifier.set(e.identifier, [])
    byIdentifier.get(e.identifier)!.push(e)
  }

  const daysToConvertList: number[] = []
  const sessionsToConvertList: number[] = []
  const people: ConvertedPerson[] = []

  for (const [identifier, personEvents] of byIdentifier) {
    const sorted = [...personEvents].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime())
    const first = sorted[0]
    let sessionsToConvert: number | null = null
    if (first.visitorId) {
      const result = await getDaysAndSessionsToConvert(first.visitorId, first.occurredAt)
      if (result) {
        daysToConvertList.push(result.daysToConvert)
        sessionsToConvertList.push(result.sessionsToConvert)
        sessionsToConvert = result.sessionsToConvert
      }
    }
    const totalValue = config.hasValue ? personEvents.reduce((sum, e) => sum + (e.value ?? 0), 0) : null
    people.push({ identifier, conversionCount: personEvents.length, totalValue, sessionsToConvert })
  }

  const avgDaysToConvert = daysToConvertList.length > 0 ? daysToConvertList.reduce((a, b) => a + b, 0) / daysToConvertList.length : null
  const avgSessionsToConvert =
    sessionsToConvertList.length > 0 ? sessionsToConvertList.reduce((a, b) => a + b, 0) / sessionsToConvertList.length : null

  const creativeCounts = new Map<string, Set<string>>()
  for (const ca of creativeAttributions) {
    if (!creativeCounts.has(ca.creativeName)) creativeCounts.set(ca.creativeName, new Set())
    creativeCounts.get(ca.creativeName)!.add(ca.identifier)
  }
  const topConvertingCreatives = [...creativeCounts.entries()]
    .map(([name, ids]) => ({ name, customers: ids.size }))
    .sort((a, b) => b.customers - a.customers)
    .slice(0, 3)

  return {
    eventType: config.eventType,
    hasValue: config.hasValue,
    avgDaysToConvert,
    avgSessionsToConvert,
    topConvertingCreatives,
    people,
  }
}
