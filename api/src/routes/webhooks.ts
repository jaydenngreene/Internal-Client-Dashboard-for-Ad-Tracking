import { FastifyInstance } from 'fastify'
import { recordPurchase } from '../lib/attribution'

export async function webhookRoutes(app: FastifyInstance) {
  // Stripe, Shopify, PayPal, Square, and GoHighLevel all have dedicated,
  // signature-verified handlers — see routes/webhooks/*.ts

  // Generic webhook — any other processor, no signature verification available
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
