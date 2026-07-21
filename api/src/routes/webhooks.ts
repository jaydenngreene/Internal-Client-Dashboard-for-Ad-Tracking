import { FastifyInstance } from 'fastify'
import { recordPurchase, NormalizedConversion } from '../lib/attribution'

// Normalize any processor payload into a standard conversion object
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

export async function webhookRoutes(app: FastifyInstance) {
  // Stripe has a dedicated, signature-verified handler — see routes/webhooks/stripe.ts
  // Shopify has a dedicated, signature-verified handler — see routes/webhooks/shopify.ts

  // PayPal webhook
  app.post('/webhooks/paypal/:client_id', async (req, reply) => {
    const { client_id } = req.params as { client_id: string }
    const body = req.body as Record<string, unknown>
    const conv = normalizePaypal(body)
    if (conv) await recordPurchase(client_id, conv)
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
    await recordPurchase(client_id, { ...body, processor: body.processor ?? 'generic' })
    return reply.code(200).send({ received: true })
  })
}
