import { db } from '../db'
import { sendConversionSignals } from './conversionSignals'

export interface NormalizedConversion {
  email: string
  revenue: number
  product?: string | null
  order_id?: string | null
  processor: string
}

type AttributionModel = 'first_click' | 'last_click' | 'linear'

interface TouchSession {
  id: string
  utm_campaign: string | null
  utm_content: string | null
  utm_source: string | null
  fbclid: string | null
  gclid: string | null
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
    `SELECT id, utm_campaign, utm_content, utm_source, fbclid, gclid
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

  const creditedTouches: Array<{ session: TouchSession; fraction: number }> =
    model === 'last_click'
      ? [{ session: sessionRows[sessionRows.length - 1], fraction: 1 }]
      : model === 'linear'
        ? sessionRows.map((session) => ({ session, fraction: 1 / sessionRows.length }))
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
    eventTime: new Date(),
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
