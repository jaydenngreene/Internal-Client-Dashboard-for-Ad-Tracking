import { FastifyInstance } from 'fastify'
import { db } from '../db'
import * as crypto from 'crypto'

// Normalize any processor payload into a standard conversion object
interface NormalizedConversion {
  email: string
  revenue: number
  product?: string
  order_id?: string
  processor: string
}

function normalizeStripe(body: Record<string, unknown>): NormalizedConversion | null {
  const type = body.type as string
  if (type !== 'checkout.session.completed' && type !== 'invoice.payment_succeeded') return null

  const obj = body.data as Record<string, Record<string, unknown>>
  const data = obj.object

  if (type === 'checkout.session.completed') {
    return {
      email: data.customer_email as string ?? (data.customer_details as Record<string, string>)?.email,
      revenue: ((data.amount_total as number) ?? 0) / 100,
      product: (data.metadata as Record<string, string>)?.product,
      order_id: data.id as string,
      processor: 'stripe',
    }
  }

  // invoice.payment_succeeded
  return {
    email: data.customer_email as string,
    revenue: ((data.amount_paid as number) ?? 0) / 100,
    order_id: data.id as string,
    processor: 'stripe',
  }
}

function normalizeShopify(body: Record<string, unknown>): NormalizedConversion | null {
  if (!body.email || !body.total_price) return null
  return {
    email: body.email as string,
    revenue: parseFloat(body.total_price as string),
    product: (body.line_items as Array<{ title: string }>)?.[0]?.title,
    order_id: String(body.id),
    processor: 'shopify',
  }
}

function normalizePaypal(body: Record<string, unknown>): NormalizedConversion | null {
  if (body.event_type !== 'PAYMENT.SALE.COMPLETED') return null
  const resource = body.resource as Record<string, unknown>
  return {
    email: (resource.payer as Record<string, Record<string, string>>)?.payer_info?.email,
    revenue: parseFloat((resource.amount as Record<string, string>)?.total ?? '0'),
    order_id: resource.id as string,
    processor: 'paypal',
  }
}

async function processConversion(clientId: string, conv: NormalizedConversion) {
  if (!conv.email || !conv.revenue) return

  const email = conv.email.toLowerCase().trim()

  const { rows: purchaseRows } = await db.query(
    `INSERT INTO purchases (client_id, email, revenue, product, order_id, processor)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [clientId, email, conv.revenue, conv.product, conv.order_id, conv.processor]
  )
  if (purchaseRows.length === 0) return // duplicate

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
    `INSERT INTO customer_ltv (client_id, email, acquisition_campaign, acquisition_ad, acquisition_source, first_purchase_date, revenue_lifetime, purchase_count)
     VALUES ($1, $2, $3, $4, $5, NOW(), $6, 1)
     ON CONFLICT (client_id, email)
     DO UPDATE SET
       revenue_lifetime = customer_ltv.revenue_lifetime + EXCLUDED.revenue_lifetime,
       purchase_count = customer_ltv.purchase_count + 1,
       last_updated = NOW()`,
    [clientId, email, session.utm_campaign, session.utm_content, session.utm_source, conv.revenue]
  )
}

export async function webhookRoutes(app: FastifyInstance) {
  // Stripe webhook
  app.post('/webhooks/stripe/:client_id', async (req, reply) => {
    const { client_id } = req.params as { client_id: string }
    const body = req.body as Record<string, unknown>
    const conv = normalizeStripe(body)
    if (conv) await processConversion(client_id, conv)
    return reply.code(200).send({ received: true })
  })

  // Shopify order webhook
  app.post('/webhooks/shopify/:client_id', async (req, reply) => {
    const { client_id } = req.params as { client_id: string }
    const body = req.body as Record<string, unknown>
    const conv = normalizeShopify(body)
    if (conv) await processConversion(client_id, conv)
    return reply.code(200).send({ received: true })
  })

  // PayPal webhook
  app.post('/webhooks/paypal/:client_id', async (req, reply) => {
    const { client_id } = req.params as { client_id: string }
    const body = req.body as Record<string, unknown>
    const conv = normalizePaypal(body)
    if (conv) await processConversion(client_id, conv)
    return reply.code(200).send({ received: true })
  })

  // Generic webhook — any other processor
  app.post('/webhooks/generic/:client_id', async (req, reply) => {
    const { client_id } = req.params as { client_id: string }
    const body = req.body as {
      email: string
      revenue: number
      product?: string
      order_id?: string
      processor?: string
    }
    if (!body.email || !body.revenue) {
      return reply.code(400).send({ error: 'email and revenue required' })
    }
    await processConversion(client_id, { ...body, processor: body.processor ?? 'generic' })
    return reply.code(200).send({ received: true })
  })
}
