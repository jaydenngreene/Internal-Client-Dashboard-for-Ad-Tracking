import { db } from '../db'
import { conversionConfigForNiche } from '../config/nicheVocabulary'
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
  uShapedCredit: number
  timeDecayCredit: number
}

interface TouchSession {
  id: string
  utm_campaign: string | null
  utm_content: string | null
  utm_source: string | null
  fbclid: string | null
  gclid: string | null
  msclkid: string | null
  started_at: string
}

interface ConversionWithTouches {
  value: number
  eventTime: string
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

export async function computeAttributionModelComparison(
  clientId: string,
  niche: string,
  from: string,
  to: string
): Promise<ModelComparisonRow[]> {
  const config = conversionConfigForNiche(niche)

  const conversions = await ((): Promise<ConversionWithTouches[]> => {
    switch (config.eventType) {
      case 'purchase':
        return getPurchaseConversions(clientId, from, to)
      case 'subscription_conversion':
        return getSubscriptionConversions(clientId, from, to)
      case 'qualified_call':
        return getCallConversions(clientId, from, to)
      case 'lead':
        return getLeadConversions(clientId, from, to)
    }
  })()

  const byName = new Map<string, ModelComparisonRow>()
  const get = (name: string): ModelComparisonRow => {
    let row = byName.get(name)
    if (!row) {
      row = { name, uShapedCredit: 0, timeDecayCredit: 0 }
      byName.set(name, row)
    }
    return row
  }

  for (const conversion of conversions) {
    const { touches, value, eventTime } = conversion
    const uShapedW = uShapedWeights(touches.length)
    const timeDecayW = timeDecayWeights(touches, new Date(eventTime))
    touches.forEach((touch, i) => {
      const row = get(touch.utm_campaign ?? UNNAMED)
      row.uShapedCredit += value * uShapedW[i]
      row.timeDecayCredit += value * timeDecayW[i]
    })
  }

  return [...byName.values()].sort((a, b) => b.uShapedCredit + b.timeDecayCredit - (a.uShapedCredit + a.timeDecayCredit))
}
