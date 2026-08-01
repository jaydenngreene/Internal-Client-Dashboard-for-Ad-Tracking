import { db } from '../db'
import { conversionConfigForNiche, ConversionEventType } from '../config/nicheVocabulary'
import { timeDecayWeights, uShapedWeights } from './attribution'

// A side-by-side U-Shaped vs Time-Decay credit comparison, per campaign, for
// the lead-driven niches (lead_gen/call/saas/other default to U-Shaped — see
// attributionDefaults.ts). Same reasoning as attributionComparison.ts's
// first-touch-vs-last-touch view: recomputed live from raw session data
// rather than the `attributions` table, which only ever stores rows for
// PURCHASES under whichever single model was active at the time - it has no
// concept of leads/calls/subscriptions at all, so there's nothing to read
// back for those niches regardless of model.
//
// "Credit" is revenue for niches with a real dollar figure (purchase,
// subscription_conversion - via mrr_delta) and a fractional conversion count
// for niches that don't (lead, qualified_call) - same hasValue split
// buyingJourney.ts already uses, so a lead_gen client sees "0.4 leads"
// rather than a misleading dollar amount that doesn't exist in their data.
export interface ModelComparisonRow {
  name: string
  // Null when no ad_costs row could resolve this touch to a real campaign -
  // the dashboard uses this to decide whether the row can link anywhere.
  platform: string | null
  uShapedCredit: number
  timeDecayCredit: number
}

export interface TouchSession {
  id: string
  utm_campaign: string | null
  utm_content: string | null
  utm_source: string | null
  fbclid: string | null
  gclid: string | null
  msclkid: string | null
  started_at: string
}

export interface ConversionWithTouches {
  value: number
  eventTime: string
  // Sorted ascending by started_at - touches[0] is the first-ever touch in
  // the 90-day window before this conversion, touches[length-1] the last one
  // before it happened. creativeRoles.ts relies on this ordering directly.
  touches: TouchSession[]
}

const TOUCH_COLUMNS = 's.id, s.utm_campaign, s.utm_content, s.utm_source, s.fbclid, s.gclid, s.msclkid, s.started_at'
const UNNAMED = '(no campaign)'

interface ConversionTouchRow {
  conversion_id: string
  value: string
  event_time: string
  session_id: string
  utm_campaign: string | null
  utm_content: string | null
  utm_source: string | null
  fbclid: string | null
  gclid: string | null
  msclkid: string | null
  started_at: string
}

function groupByConversion(rows: ConversionTouchRow[]): ConversionWithTouches[] {
  const byConversion = new Map<string, ConversionWithTouches>()
  for (const r of rows) {
    let conversion = byConversion.get(r.conversion_id)
    if (!conversion) {
      conversion = { value: parseFloat(r.value), eventTime: r.event_time, touches: [] }
      byConversion.set(r.conversion_id, conversion)
    }
    conversion.touches.push({
      id: r.session_id,
      utm_campaign: r.utm_campaign,
      utm_content: r.utm_content,
      utm_source: r.utm_source,
      fbclid: r.fbclid,
      gclid: r.gclid,
      msclkid: r.msclkid,
      started_at: r.started_at,
    })
  }
  // Every touch's own started_at was already constrained to the 90-day
  // window in SQL - sort ascending here purely so u_shaped's "first/last"
  // positions land correctly regardless of the join's row order.
  for (const c of byConversion.values()) {
    c.touches.sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())
  }
  return [...byConversion.values()]
}

async function getPurchaseConversions(clientId: string, from: string, to: string): Promise<ConversionWithTouches[]> {
  const { rows } = await db.query<ConversionTouchRow>(
    `SELECT p.id AS conversion_id, p.revenue AS value, p.purchased_at AS event_time, ${TOUCH_COLUMNS}
     FROM purchases p
     JOIN identities i ON i.client_id = p.client_id AND i.email = p.email
     JOIN sessions s ON s.visitor_id = i.visitor_id
       AND s.started_at <= p.purchased_at AND s.started_at >= p.purchased_at - INTERVAL '90 days'
     WHERE p.client_id = $1 AND NOT p.refunded AND p.purchased_at::date BETWEEN $2 AND $3`,
    [clientId, from, to]
  )
  return groupByConversion(rows)
}

async function getSubscriptionConversions(clientId: string, from: string, to: string): Promise<ConversionWithTouches[]> {
  const { rows } = await db.query<ConversionTouchRow>(
    `SELECT se.id AS conversion_id, se.mrr_delta AS value, se.occurred_at AS event_time, ${TOUCH_COLUMNS}
     FROM subscription_events se
     JOIN subscriptions sub ON sub.id = se.subscription_id
     JOIN identities i ON i.client_id = se.client_id AND i.email = sub.email
     JOIN sessions s ON s.visitor_id = i.visitor_id
       AND s.started_at <= se.occurred_at AND s.started_at >= se.occurred_at - INTERVAL '90 days'
     WHERE se.client_id = $1 AND se.event_type IN ('trial_converted', 'activated')
       AND se.occurred_at::date BETWEEN $2 AND $3`,
    [clientId, from, to]
  )
  return groupByConversion(rows)
}

async function getLeadConversions(clientId: string, from: string, to: string): Promise<ConversionWithTouches[]> {
  const { rows } = await db.query<ConversionTouchRow>(
    `SELECT l.id AS conversion_id, 1::numeric AS value, l.created_at AS event_time, ${TOUCH_COLUMNS}
     FROM leads l
     JOIN identities i ON i.client_id = l.client_id AND i.email = l.email
     JOIN sessions s ON s.visitor_id = i.visitor_id
       AND s.started_at <= l.created_at AND s.started_at >= l.created_at - INTERVAL '90 days'
     WHERE l.client_id = $1 AND l.created_at::date BETWEEN $2 AND $3`,
    [clientId, from, to]
  )
  return groupByConversion(rows)
}

async function getCallConversions(clientId: string, from: string, to: string): Promise<ConversionWithTouches[]> {
  // A call's session_id is a direct FK (see buyingJourney.ts's getCallEvents) -
  // its own session is always one of its touches, on top of whatever else
  // that visitor did in the 90-day window before the call.
  const { rows } = await db.query<ConversionTouchRow>(
    `SELECT c.id AS conversion_id, 1::numeric AS value, c.started_at AS event_time, ${TOUCH_COLUMNS}
     FROM calls c
     JOIN sessions call_session ON call_session.id = c.session_id
     JOIN sessions s ON s.visitor_id = call_session.visitor_id
       AND s.started_at <= c.started_at AND s.started_at >= c.started_at - INTERVAL '90 days'
     WHERE c.client_id = $1 AND c.qualified = TRUE AND c.started_at::date BETWEEN $2 AND $3`,
    [clientId, from, to]
  )
  return groupByConversion(rows)
}

// Which fetcher runs depends only on the niche's declared event type - shared
// with creativeRoles.ts, which needs the exact same per-conversion touch
// lists to classify opener/closer/assist roles, just aggregated differently.
export function getConversionsForNiche(
  clientId: string,
  eventType: ConversionEventType,
  from: string,
  to: string
): Promise<ConversionWithTouches[]> {
  switch (eventType) {
    case 'purchase':
      return getPurchaseConversions(clientId, from, to)
    case 'subscription_conversion':
      return getSubscriptionConversions(clientId, from, to)
    case 'qualified_call':
      return getCallConversions(clientId, from, to)
    case 'lead':
      return getLeadConversions(clientId, from, to)
  }
}

interface AdCostsCampaign {
  campaign_id: string | null
  campaign_name: string
  platform: string
}

const normalizePlatform = (s: string | null) => (s ?? '').trim().toLowerCase().replace(/_ads$/, '')

// Resolves a touch's raw utm_campaign (frequently the ad platform's numeric
// campaign id, not a human name) against this client's ad_costs rows - same
// id-or-name + platform matching convention as every other report in this
// app (see attributionComparison.ts's campaignResolutionLateral for the SQL
// equivalent; done in JS here since this file's four fetchers each already
// run their own query, and fetching ad_costs once is cheaper than repeating
// that join four times).
function resolveCampaign(
  utmCampaign: string | null,
  utmSource: string | null,
  adCosts: AdCostsCampaign[]
): { name: string; platform: string | null } {
  if (!utmCampaign) return { name: UNNAMED, platform: null }
  const normalizedSource = normalizePlatform(utmSource)
  const match = adCosts.find(
    (c) =>
      normalizePlatform(c.platform) === normalizedSource &&
      (c.campaign_id === utmCampaign || c.campaign_name.trim().toLowerCase() === utmCampaign.trim().toLowerCase())
  )
  return match ? { name: match.campaign_name, platform: match.platform } : { name: utmCampaign, platform: null }
}

export async function computeAttributionModelComparison(
  clientId: string,
  niche: string,
  from: string,
  to: string
): Promise<ModelComparisonRow[]> {
  const config = conversionConfigForNiche(niche)

  const [conversions, adCostsRows] = await Promise.all([
    getConversionsForNiche(clientId, config.eventType, from, to),
    db.query<AdCostsCampaign>(
      `SELECT DISTINCT campaign_id, campaign_name, platform FROM ad_costs WHERE client_id = $1 AND campaign_name IS NOT NULL`,
      [clientId]
    ),
  ])
  const adCosts = adCostsRows.rows

  const byKey = new Map<string, ModelComparisonRow>()
  // Keyed by name+platform, not name alone - the same campaign name can exist
  // on two different platforms, and collapsing those into one row would
  // silently blend their numbers together.
  const get = (name: string, platform: string | null): ModelComparisonRow => {
    const key = `${name}::${platform ?? ''}`
    let row = byKey.get(key)
    if (!row) {
      row = { name, platform, uShapedCredit: 0, timeDecayCredit: 0 }
      byKey.set(key, row)
    }
    return row
  }

  for (const conversion of conversions) {
    const { touches, value, eventTime } = conversion
    const uShapedW = uShapedWeights(touches.length)
    const timeDecayW = timeDecayWeights(touches, new Date(eventTime))
    touches.forEach((touch, i) => {
      const { name, platform } = resolveCampaign(touch.utm_campaign, touch.utm_source, adCosts)
      const row = get(name, platform)
      row.uShapedCredit += value * uShapedW[i]
      row.timeDecayCredit += value * timeDecayW[i]
    })
  }

  return [...byKey.values()].sort((a, b) => b.uShapedCredit + b.timeDecayCredit - (a.uShapedCredit + a.timeDecayCredit))
}
