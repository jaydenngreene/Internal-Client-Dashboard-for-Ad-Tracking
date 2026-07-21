import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { db } from '../../db'
import { recordPurchase, recordRefund } from '../../lib/attribution'
import { autoLinkByPhone } from '../../lib/identityLinking'

interface GoHighLevelConfig {
  webhook_secret: string
}

async function getIntegration(clientId: string): Promise<GoHighLevelConfig | null> {
  const { rows } = await db.query<{ config: GoHighLevelConfig }>(
    `SELECT config FROM client_integrations WHERE client_id = $1 AND platform = 'gohighlevel'`,
    [clientId]
  )
  return rows[0]?.config ?? null
}

// GHL doesn't have one fixed payment-webhook schema or built-in HMAC signing the way
// Shopify/Square/Stripe do — "webhooks" here means their workflow builder's custom
// webhook action, where the client maps whatever fields they want into the JSON body.
// This route expects that mapping to look like the shape below; `secret` is the
// shared value the client pastes into both their GHL workflow and the integration
// config here, since there's no platform-level signature to verify instead.
interface GoHighLevelPayload {
  secret?: string
  event: 'charge' | 'refund'
  contact?: { email?: string; phone?: string }
  email?: string
  phone?: string
  amount?: number
  transaction_id?: string
  order_id?: string
}

export async function goHighLevelWebhookRoutes(app: FastifyInstance) {
  app.post<{ Params: { client_id: string }; Body: GoHighLevelPayload }>(
    '/webhooks/gohighlevel/:client_id',
    async (req: FastifyRequest<{ Params: { client_id: string }; Body: GoHighLevelPayload }>, reply: FastifyReply) => {
      const { client_id } = req.params
      const body = req.body

      const config = await getIntegration(client_id)
      if (config?.webhook_secret && body.secret !== config.webhook_secret) {
        return reply.code(401).send({ error: 'Invalid or missing secret' })
      }

      const email = body.contact?.email ?? body.email
      const phone = body.contact?.phone ?? body.phone
      const orderId = body.transaction_id ?? body.order_id
      const amount = body.amount ?? 0

      if (body.event === 'refund') {
        if (orderId && amount > 0) {
          await recordRefund(client_id, orderId, amount)
        }
      } else {
        if (email && amount > 0) {
          await recordPurchase(client_id, {
            email,
            revenue: amount,
            order_id: orderId,
            processor: 'gohighlevel',
          })
        }
      }

      // Step 15 — if this email already has an identity (from the normal opt-in/
      // pixel flow) and GHL also gave us a phone, persist it and look for other
      // identities sharing that phone. GHL isn't itself an attribution capture
      // point, so this only does anything when an identities row already exists —
      // never blocks the purchase/refund flow above on failure.
      if (email && phone) {
        try {
          await db.query(
            `UPDATE identities SET phone = COALESCE(phone, $1) WHERE client_id = $2 AND email = $3`,
            [phone, client_id, email.toLowerCase().trim()]
          )
          await autoLinkByPhone(client_id, email.toLowerCase().trim(), phone)
        } catch (err) {
          console.error(`[identityLinking] GoHighLevel failed for client=${client_id}:`, (err as Error).message)
        }
      }

      return reply.code(200).send({ received: true })
    }
  )
}
