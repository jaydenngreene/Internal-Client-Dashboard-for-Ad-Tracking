import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as crypto from 'crypto'
import { db } from '../../db'

interface ShopifyOrder {
  id: number
  email: string
  total_price: string
  subtotal_price: string
  total_tax: string
  currency: string
  financial_status: string
  fulfillment_status: string | null
  cancel_reason: string | null
  cancelled_at: string | null
  created_at: string
  landing_site: string | null
  referring_site: string | null
  source_name: string | null
  note: string | null
  tags: string
  customer: {
    id: number
    email: string
    first_name: string
    last_name: string
  } | null
  line_items: Array<{
    id: number
    title: string
    quantity: number
    price: string
    variant_title: string | null
  }>
  refunds: Array<{
    id: number
    created_at: string
    transactions: Array<{ amount: string }>
  }>
}

interface ShopifyRefund {
  id: number
  order_id: number
  created_at: string
  transactions: Array<{
    id: number
    amount: string
    kind: string
    status: string
  }>
}

async function getWebhookSecret(clientId: string): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT config->>'webhook_secret' AS secret
     FROM client_integrations
     WHERE client_id = $1 AND platform = 'shopify'`,
    [clientId]
  )
  return rows[0]?.secret ?? null
}

function verifyShopifyHmac(rawBody: Buffer, hmacHeader: string, secret: string): boolean {
  const computed = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64')
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hmacHeader))
  } catch {
    return false
  }
}

async function attributeAndRecord(
  clientId: string,
  email: string,
  revenue: number,
  orderId: string,
  productName: string | null,
  processor: string
) {
  const normalizedEmail = email.toLowerCase().trim()

  const { rows: purchaseRows } = await db.query(
    `INSERT INTO purchases (client_id, email, revenue, product, order_id, processor)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [clientId, normalizedEmail, revenue, productName, orderId, processor]
  )
  if (purchaseRows.length === 0) return // duplicate

  const purchaseId = purchaseRows[0].id

  // Find identity → visitor → session
  const { rows: identityRows } = await db.query(
    'SELECT visitor_id FROM identities WHERE client_id = $1 AND email = $2',
    [clientId, normalizedEmail]
  )
  if (identityRows.length === 0) return

  const visitorId = identityRows[0].visitor_id

  const { rows: sessionRows } = await db.query(
    `SELECT id, utm_campaign, utm_content, utm_source, fbclid, gclid
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
    [clientId, purchaseId, session.id, revenue]
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
    [clientId, normalizedEmail, session.utm_campaign, session.utm_content, session.utm_source, revenue]
  )
}

export async function shopifyWebhookRoutes(app: FastifyInstance) {
  // Disable body parsing for these routes — we need the raw body for HMAC verification
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body)
  )

  // orders/create — new purchase
  app.post(
    '/webhooks/shopify/:client_id/orders',
    async (req: FastifyRequest<{ Params: { client_id: string } }>, reply: FastifyReply) => {
      const { client_id } = req.params
      const rawBody = req.body as Buffer
      const hmacHeader = req.headers['x-shopify-hmac-sha256'] as string
      const topic = req.headers['x-shopify-topic'] as string

      const secret = await getWebhookSecret(client_id)
      if (secret && hmacHeader) {
        if (!verifyShopifyHmac(rawBody, hmacHeader, secret)) {
          return reply.code(401).send({ error: 'Invalid signature' })
        }
      }

      const order: ShopifyOrder = JSON.parse(rawBody.toString())

      // Skip cancelled or refunded orders
      if (order.cancelled_at || order.cancel_reason) {
        return reply.code(200).send({ received: true, skipped: 'cancelled' })
      }

      const email = order.email ?? order.customer?.email
      if (!email) return reply.code(200).send({ received: true, skipped: 'no_email' })

      const revenue = parseFloat(order.total_price)
      const productName = order.line_items?.[0]?.title ?? null
      const orderId = String(order.id)

      await attributeAndRecord(client_id, email, revenue, orderId, productName, 'shopify')

      return reply.code(200).send({ received: true })
    }
  )

  // refunds/create — deduct revenue from attribution
  app.post(
    '/webhooks/shopify/:client_id/refunds',
    async (req: FastifyRequest<{ Params: { client_id: string } }>, reply: FastifyReply) => {
      const { client_id } = req.params
      const rawBody = req.body as Buffer
      const hmacHeader = req.headers['x-shopify-hmac-sha256'] as string

      const secret = await getWebhookSecret(client_id)
      if (secret && hmacHeader) {
        if (!verifyShopifyHmac(rawBody, hmacHeader, secret)) {
          return reply.code(401).send({ error: 'Invalid signature' })
        }
      }

      const refund: ShopifyRefund = JSON.parse(rawBody.toString())
      const orderId = String(refund.order_id)
      const refundAmount = refund.transactions
        .filter((t) => t.status === 'success' && t.kind === 'refund')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0)

      if (refundAmount <= 0) return reply.code(200).send({ received: true })

      // Mark purchase as refunded and deduct from LTV
      const { rows: purchaseRows } = await db.query(
        `UPDATE purchases
         SET refunded = TRUE, refunded_at = NOW()
         WHERE client_id = $1 AND order_id = $2
         RETURNING email, revenue`,
        [client_id, orderId]
      )
      if (purchaseRows.length === 0) return reply.code(200).send({ received: true })

      const { email, revenue } = purchaseRows[0]

      await db.query(
        `UPDATE customer_ltv
         SET revenue_lifetime = GREATEST(0, revenue_lifetime - $3),
             purchase_count   = GREATEST(0, purchase_count - 1),
             last_updated     = NOW()
         WHERE client_id = $1 AND email = $2`,
        [client_id, email.toLowerCase(), refundAmount]
      )

      // Also update attribution
      const { rows: purchaseForAttr } = await db.query(
        'SELECT id FROM purchases WHERE client_id = $1 AND order_id = $2',
        [client_id, orderId]
      )
      if (purchaseForAttr.length > 0) {
        await db.query(
          `UPDATE attributions
           SET attributed_revenue = GREATEST(0, attributed_revenue - $2)
           WHERE purchase_id = $1`,
          [purchaseForAttr[0].id, refundAmount]
        )
      }

      return reply.code(200).send({ received: true })
    }
  )
}
