import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { db } from '../../db'
import { recordPurchase, recordRefund } from '../../lib/attribution'

interface PaypalConfig {
  client_id: string
  client_secret: string
  webhook_id: string
  sandbox?: boolean
}

async function getIntegration(clientId: string): Promise<PaypalConfig | null> {
  const { rows } = await db.query<{ config: PaypalConfig }>(
    `SELECT config FROM client_integrations WHERE client_id = $1 AND platform = 'paypal'`,
    [clientId]
  )
  return rows[0]?.config ?? null
}

function apiBase(config: PaypalConfig): string {
  return config.sandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com'
}

async function getPaypalAccessToken(config: PaypalConfig): Promise<string> {
  const res = await fetch(`${apiBase(config)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.client_id}:${config.client_secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (!res.ok) throw new Error(`PayPal OAuth token request failed (${res.status})`)
  const data = (await res.json()) as { access_token: string }
  return data.access_token
}

// PayPal doesn't sign webhooks with a local HMAC secret like Shopify/Square — you
// verify by round-tripping the transmission headers + raw event back to PayPal's own
// verification endpoint.
async function verifyPaypalSignature(
  headers: Record<string, string | string[] | undefined>,
  rawBody: Buffer,
  config: PaypalConfig
): Promise<boolean> {
  const accessToken = await getPaypalAccessToken(config)
  const res = await fetch(`${apiBase(config)}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transmission_id: headers['paypal-transmission-id'],
      transmission_time: headers['paypal-transmission-time'],
      cert_url: headers['paypal-cert-url'],
      auth_algo: headers['paypal-auth-algo'],
      transmission_sig: headers['paypal-transmission-sig'],
      webhook_id: config.webhook_id,
      webhook_event: JSON.parse(rawBody.toString()),
    }),
  })
  if (!res.ok) return false
  const data = (await res.json()) as { verification_status: string }
  return data.verification_status === 'SUCCESS'
}

interface PaypalWebhookEvent {
  event_type: string
  resource: {
    id: string
    amount?: { total: string; currency?: string }
    sale_id?: string
    parent_payment?: string
    payer?: { payer_info?: { email?: string } }
  }
}

export async function paypalWebhookRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body))

  app.post(
    '/webhooks/paypal/:client_id',
    async (req: FastifyRequest<{ Params: { client_id: string } }>, reply: FastifyReply) => {
      const { client_id } = req.params
      const rawBody = req.body as Buffer

      const config = await getIntegration(client_id)
      if (config?.webhook_id) {
        const verified = await verifyPaypalSignature(req.headers as Record<string, string>, rawBody, config).catch(
          (err) => {
            app.log.warn({ err }, 'PayPal signature verification request failed')
            return false
          }
        )
        if (!verified) return reply.code(401).send({ error: 'Invalid signature' })
      }

      const event = JSON.parse(rawBody.toString()) as PaypalWebhookEvent

      if (event.event_type === 'PAYMENT.SALE.COMPLETED') {
        const email = event.resource.payer?.payer_info?.email
        const revenue = parseFloat(event.resource.amount?.total ?? '0')
        if (email && revenue > 0) {
          await recordPurchase(client_id, {
            email,
            revenue,
            order_id: event.resource.id,
            processor: 'paypal',
            currency: event.resource.amount?.currency,
          })
        }
      } else if (event.event_type === 'PAYMENT.SALE.REFUNDED') {
        // The refund resource doesn't carry the payer's email, but recordRefund()
        // never needed it — it looks the purchase up by order_id alone, and
        // `sale_id` here is exactly the original sale's resource.id we stored as
        // order_id when PAYMENT.SALE.COMPLETED first came in.
        const originalOrderId = event.resource.sale_id ?? event.resource.parent_payment
        const refundAmount = parseFloat(event.resource.amount?.total ?? '0')
        if (originalOrderId && refundAmount > 0) {
          await recordRefund(client_id, originalOrderId, refundAmount, event.resource.amount?.currency)
        }
      }

      return reply.code(200).send({ received: true })
    }
  )
}
