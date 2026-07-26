import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as crypto from 'crypto'
import { db } from '../../db'
import { recordPurchase, recordRefund } from '../../lib/attribution'

export interface HousecallProConfig {
  webhook_secret: string
}

async function getIntegration(clientId: string): Promise<HousecallProConfig | null> {
  const { rows } = await db.query<{ config: HousecallProConfig }>(
    `SELECT config FROM client_integrations WHERE client_id = $1 AND platform = 'housecallpro'`,
    [clientId]
  )
  return rows[0]?.config ?? null
}

// Housecall Pro issues a signing secret when a webhook URL is registered (Settings
// -> Webhooks, only available on their MAX plan) and signs the raw request body
// with it, HMAC-SHA256 hex-encoded, in the `x-housecall-signature` header. Sourced
// from HCP's own integration guides, not verified against a live account yet -
// same disclosure this app already carries for Bing Ads (hand-rolled against
// documented behavior, confirm against a real delivery once a client is live).
export function verifyHousecallProSignature(rawBody: Buffer, signatureHeader: string, config: HousecallProConfig): boolean {
  const computed = crypto.createHmac('sha256', config.webhook_secret).update(rawBody).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signatureHeader))
  } catch {
    return false
  }
}

// Field names below match HCP's documented Invoice/Customer resource shape as
// closely as available docs show, with fallbacks across the couple of nesting
// variants their own guides and community integrations show (top-level customer
// vs. invoice.customer, total_amount vs. amount_paid) - same defensive-parsing
// convention GoHighLevel's handler already uses for a payload this app can't
// dry-run against a real account. Confirm the real shape via HCP's webhook
// delivery log (Settings -> Webhooks -> a specific webhook's log) once this
// client's first real invoice fires, and tighten this if it turns out wrong.
interface HousecallProCustomer {
  email?: string
  id?: string
}
interface HousecallProInvoice {
  id?: string
  invoice_number?: string
  total_amount?: number // cents, per Money conventions elsewhere in HCP's API
  amount_paid?: number
  customer?: HousecallProCustomer
}
interface HousecallProWebhookPayload {
  event: string
  invoice?: HousecallProInvoice
  customer?: HousecallProCustomer
}

const PAID_EVENTS = new Set(['invoice.paid', 'invoice.payment.succeeded'])
const REFUND_EVENTS = new Set(['invoice.refund.succeeded'])

function centsToDollars(amount: number | undefined): number {
  return typeof amount === 'number' ? amount / 100 : 0
}

export async function housecallProWebhookRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body))

  app.post(
    '/webhooks/housecallpro/:client_id',
    async (req: FastifyRequest<{ Params: { client_id: string } }>, reply: FastifyReply) => {
      const { client_id } = req.params
      const rawBody = req.body as Buffer
      const signature = req.headers['x-housecall-signature'] as string | undefined

      const config = await getIntegration(client_id)
      if (config?.webhook_secret) {
        if (!signature || !verifyHousecallProSignature(rawBody, signature, config)) {
          return reply.code(401).send({ error: 'Invalid signature' })
        }
      }

      let payload: HousecallProWebhookPayload
      try {
        payload = JSON.parse(rawBody.toString())
      } catch {
        return reply.code(400).send({ error: 'Invalid JSON' })
      }

      const invoice = payload.invoice
      const email = invoice?.customer?.email ?? payload.customer?.email
      const orderId = invoice?.id ?? invoice?.invoice_number

      if (PAID_EVENTS.has(payload.event)) {
        const revenue = centsToDollars(invoice?.amount_paid ?? invoice?.total_amount)
        if (email && orderId && revenue > 0) {
          await recordPurchase(client_id, {
            email,
            revenue,
            order_id: orderId,
            processor: 'housecallpro',
          })
        }
      } else if (REFUND_EVENTS.has(payload.event)) {
        const refundAmount = centsToDollars(invoice?.amount_paid ?? invoice?.total_amount)
        if (orderId && refundAmount > 0) {
          await recordRefund(client_id, orderId, refundAmount)
        }
      }

      return reply.code(200).send({ received: true })
    }
  )
}
