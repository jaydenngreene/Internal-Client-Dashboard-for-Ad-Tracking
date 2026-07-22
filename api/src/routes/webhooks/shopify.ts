import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as crypto from 'crypto'
import { db } from '../../db'
import { recordPurchase, recordRefund } from '../../lib/attribution'

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
    currency?: string
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

export function verifyShopifyHmac(rawBody: Buffer, hmacHeader: string, secret: string): boolean {
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

      await recordPurchase(client_id, {
        email,
        revenue,
        product: productName,
        order_id: orderId,
        processor: 'shopify',
        currency: order.currency,
      })

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
      const refundTransactions = refund.transactions.filter((t) => t.status === 'success' && t.kind === 'refund')
      const refundAmount = refundTransactions.reduce((sum, t) => sum + parseFloat(t.amount), 0)

      await recordRefund(client_id, orderId, refundAmount, refundTransactions[0]?.currency)

      return reply.code(200).send({ received: true })
    }
  )
}
