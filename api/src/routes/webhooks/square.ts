import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as crypto from 'crypto'
import { db } from '../../db'
import { recordPurchase, recordRefund } from '../../lib/attribution'

export interface SquareConfig {
  signature_key: string
  notification_url: string
}

async function getIntegration(clientId: string): Promise<SquareConfig | null> {
  const { rows } = await db.query<{ config: SquareConfig }>(
    `SELECT config FROM client_integrations WHERE client_id = $1 AND platform = 'square'`,
    [clientId]
  )
  return rows[0]?.config ?? null
}

// Square signs (notification_url + raw_body) with the signature key, base64-encoded.
export function verifySquareSignature(rawBody: Buffer, signatureHeader: string, config: SquareConfig): boolean {
  const computed = crypto
    .createHmac('sha256', config.signature_key)
    .update(config.notification_url + rawBody.toString())
    .digest('base64')
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signatureHeader))
  } catch {
    return false
  }
}

interface SquarePayment {
  id: string
  status: string
  amount_money: { amount: number; currency: string }
  buyer_email_address?: string
  refunded_money?: { amount: number }
}

interface SquareWebhookEvent {
  type: string
  data: { object: { payment: SquarePayment } }
}

export async function squareWebhookRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body))

  app.post(
    '/webhooks/square/:client_id',
    async (req: FastifyRequest<{ Params: { client_id: string } }>, reply: FastifyReply) => {
      const { client_id } = req.params
      const rawBody = req.body as Buffer
      const signature = req.headers['x-square-hmacsha256-signature'] as string | undefined

      const config = await getIntegration(client_id)
      if (config?.signature_key) {
        if (!signature || !verifySquareSignature(rawBody, signature, config)) {
          return reply.code(401).send({ error: 'Invalid signature' })
        }
      }

      const event = JSON.parse(rawBody.toString()) as SquareWebhookEvent
      const payment = event.data?.object?.payment

      if (payment && (event.type === 'payment.updated' || event.type === 'payment.created')) {
        const email = payment.buyer_email_address
        const revenue = (payment.amount_money?.amount ?? 0) / 100

        if (payment.status === 'COMPLETED' && email && revenue > 0) {
          await recordPurchase(client_id, {
            email,
            revenue,
            order_id: payment.id,
            processor: 'square',
          })
        }

        const refundedAmount = (payment.refunded_money?.amount ?? 0) / 100
        if (refundedAmount > 0) {
          await recordRefund(client_id, payment.id, refundedAmount)
        }
      }

      return reply.code(200).send({ received: true })
    }
  )
}
