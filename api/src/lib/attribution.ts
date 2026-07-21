import { db } from '../db'

export interface NormalizedConversion {
  email: string
  revenue: number
  product?: string | null
  order_id?: string | null
  processor: string
}

// Insert a purchase, walk back to the ad session that acquired the customer,
// write attribution credit, and roll the revenue into customer_ltv.
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

  const { rows: sessionRows } = await db.query(
    `SELECT id, utm_campaign, utm_content, utm_source
     FROM sessions
     WHERE visitor_id = $1
       AND started_at >= NOW() - INTERVAL '90 days'
     ORDER BY started_at ASC
     LIMIT 1`,
    [visitorId]
  )
  if (sessionRows.length === 0) return

  const session = sessionRows[0]

  await db.query(
    `INSERT INTO attributions (client_id, purchase_id, session_id, model, credit_fraction, attributed_revenue)
     VALUES ($1, $2, $3, 'first_click', 1.0, $4)`,
    [clientId, purchaseId, session.id, conv.revenue]
  )

  await db.query(
    `INSERT INTO customer_ltv
       (client_id, email, acquisition_campaign, acquisition_ad, acquisition_source, first_purchase_date, revenue_lifetime, purchase_count)
     VALUES ($1, $2, $3, $4, $5, NOW(), $6, 1)
     ON CONFLICT (client_id, email)
     DO UPDATE SET
       revenue_lifetime = customer_ltv.revenue_lifetime + EXCLUDED.revenue_lifetime,
       purchase_count   = customer_ltv.purchase_count + 1,
       last_updated     = NOW()`,
    [clientId, email, session.utm_campaign, session.utm_content, session.utm_source, conv.revenue]
  )
}

// Deduct a refund from the matching purchase, its attribution record, and customer_ltv.
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
     SET attributed_revenue = GREATEST(0, attributed_revenue - $2)
     WHERE purchase_id = $1`,
    [purchaseId, refundAmount]
  )
}
