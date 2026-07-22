import { db } from '../db'
import { sendConversionSignals } from './conversionSignals'
import { dispatchEvent } from './outboundWebhooks'

export interface NormalizedConversion {
  email: string
  revenue: number
  product?: string | null
  order_id?: string | null
  processor: string
}

type AttributionModel = 'first_click' | 'last_click' | 'linear' | 'time_decay' | 'u_shaped'

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

// 7-day half-life: a touch a week before conversion gets half the credit of one
// on the day of conversion. Weights are normalized to sum to 1 afterward, so the
// half-life value only controls how sharply credit skews toward recency, not the
// absolute scale.
const TIME_DECAY_HALF_LIFE_DAYS = 7

function timeDecayWeights(sessions: TouchSession[], purchaseTime: Date): number[] {
  const rawWeights = sessions.map((s) => {
    const daysBefore = (purchaseTime.getTime() - new Date(s.started_at).getTime()) / (1000 * 60 * 60 * 24)
    return Math.pow(2, -Math.max(daysBefore, 0) / TIME_DECAY_HALF_LIFE_DAYS)
  })
  const total = rawWeights.reduce((a, b) => a + b, 0)
  return rawWeights.map((w) => w / total)
}

// Standard position-based/U-shaped split: 40% first touch, 40% last touch, the
// remaining 20% divided evenly across whatever touches fall in between. Collapses
// sensibly for 1 touch (100%) and 2 touches (50/50, no middle to split).
function uShapedWeights(count: number): number[] {
  if (count === 1) return [1]
  if (count === 2) return [0.5, 0.5]
  const middleWeight = 0.2 / (count - 2)
  return Array.from({ length: count }, (_, i) => (i === 0 || i === count - 1 ? 0.4 : middleWeight))
}

// Insert a purchase, walk back through the customer's ad sessions, split revenue
// credit across them per the client's attribution model, and roll revenue into customer_ltv.
export async function recordPurchase(clientId: string, conv: NormalizedConversion): Promise<void> {
  if (!conv.email || !conv.revenue) return

  const email = conv.email.toLowerCase().trim()

  const { rows: purchaseRows } = await db.query(
    `INSERT INTO purchases (client_id, email, revenue, product, order_id, processor)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (client_id, order_id) WHERE order_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [clientId, email, conv.revenue, conv.product ?? null, conv.order_id ?? null, conv.processor]
  )
  if (purchaseRows.length === 0) return // duplicate (webhook retry)

  const purchaseId = purchaseRows[0].id

  const { rows: identityRows } = await db.query(
    'SELECT visitor_id FROM identities WHERE client_id = $1 AND email = $2',
    [clientId, email]
  )
  if (identityRows.length === 0) return // no ad history to attribute

  const visitorId = identityRows[0].visitor_id

  const { rows: sessionRows } = await db.query<TouchSession>(
    `SELECT id, utm_campaign, utm_content, utm_source, fbclid, gclid, msclkid, started_at
     FROM sessions
     WHERE visitor_id = $1
       AND started_at >= NOW() - INTERVAL '90 days'
     ORDER BY started_at ASC`,
    [visitorId]
  )
  if (sessionRows.length === 0) return

  const { rows: clientRows } = await db.query<{ attribution_model: AttributionModel }>(
    'SELECT attribution_model FROM clients WHERE id = $1',
    [clientId]
  )
  const model: AttributionModel = clientRows[0]?.attribution_model ?? 'first_click'

  // Acquisition channel for LTV is always the true first touch, independent of
  // attribution model — the model only changes how revenue credit is split for ROAS.
  const firstSession = sessionRows[0]

  const timeDecayWeightsForSessions = model === 'time_decay' ? timeDecayWeights(sessionRows, new Date()) : null
  const uShapedWeightsForSessions = model === 'u_shaped' ? uShapedWeights(sessionRows.length) : null

  const creditedTouches: Array<{ session: TouchSession; fraction: number }> =
    model === 'last_click'
      ? [{ session: sessionRows[sessionRows.length - 1], fraction: 1 }]
      : model === 'linear'
        ? sessionRows.map((session) => ({ session, fraction: 1 / sessionRows.length }))
        : timeDecayWeightsForSessions
          ? sessionRows.map((session, i) => ({ session, fraction: timeDecayWeightsForSessions[i] }))
          : uShapedWeightsForSessions
            ? sessionRows.map((session, i) => ({ session, fraction: uShapedWeightsForSessions[i] }))
            : [{ session: firstSession, fraction: 1 }]

  for (const { session, fraction } of creditedTouches) {
    await db.query(
      `INSERT INTO attributions (client_id, purchase_id, session_id, model, credit_fraction, attributed_revenue)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [clientId, purchaseId, session.id, model, fraction, conv.revenue * fraction]
    )
  }

  await db.query(
    `INSERT INTO customer_ltv
       (client_id, email, acquisition_campaign, acquisition_ad, acquisition_source, first_purchase_date, revenue_lifetime, purchase_count)
     VALUES ($1, $2, $3, $4, $5, NOW(), $6, 1)
     ON CONFLICT (client_id, email)
     DO UPDATE SET
       revenue_lifetime = customer_ltv.revenue_lifetime + EXCLUDED.revenue_lifetime,
       purchase_count   = customer_ltv.purchase_count + 1,
       last_updated     = NOW()`,
    [clientId, email, firstSession.utm_campaign, firstSession.utm_content, firstSession.utm_source, conv.revenue]
  )

  // Signal the ad platforms using whichever click is most recently "live" for this
  // visitor (the last touch), matching how the platforms' own pixels behave — their
  // click-id cookies get overwritten by the most recent click, not the first one.
  const lastSession = sessionRows[sessionRows.length - 1]
  await sendConversionSignals(clientId, {
    eventType: 'Purchase',
    email,
    value: conv.revenue,
    fbclid: lastSession.fbclid,
    gclid: lastSession.gclid,
    msclkid: lastSession.msclkid,
    eventTime: new Date(),
  })

  // Step 29 — notify any of the client's own systems subscribed to this event.
  await dispatchEvent(clientId, 'sale.attributed', {
    email,
    revenue: conv.revenue,
    product: conv.product ?? null,
    order_id: conv.order_id ?? null,
    processor: conv.processor,
    attribution_model: model,
  })
}

// Deduct a refund from the matching purchase, its attribution record(s), and customer_ltv.
// Refund is prorated across attribution rows by credit_fraction, so linear-model
// purchases (multiple touches) get the refund split the same way the revenue was.
export async function recordRefund(clientId: string, orderId: string, refundAmount: number): Promise<void> {
  if (refundAmount <= 0) return

  const { rows: purchaseRows } = await db.query(
    `UPDATE purchases
     SET refunded = TRUE, refunded_at = NOW()
     WHERE client_id = $1 AND order_id = $2
     RETURNING id, email`,
    [clientId, orderId]
  )
  if (purchaseRows.length === 0) return

  const { id: purchaseId, email } = purchaseRows[0]

  await db.query(
    `UPDATE customer_ltv
     SET revenue_lifetime = GREATEST(0, revenue_lifetime - $3),
         purchase_count   = GREATEST(0, purchase_count - 1),
         last_updated     = NOW()
     WHERE client_id = $1 AND email = $2`,
    [clientId, String(email).toLowerCase(), refundAmount]
  )

  await db.query(
    `UPDATE attributions
     SET attributed_revenue = GREATEST(0, attributed_revenue - ($2 * credit_fraction))
     WHERE purchase_id = $1`,
    [purchaseId, refundAmount]
  )
}
