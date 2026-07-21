import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import Stripe from 'stripe'
import { db } from '../../db'
import { recordPurchase, recordRefund } from '../../lib/attribution'

async function getWebhookSecret(clientId: string): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT config->>'webhook_secret' AS secret
     FROM client_integrations
     WHERE client_id = $1 AND platform = 'stripe'`,
    [clientId]
  )
  return rows[0]?.secret ?? null
}

// Only used to verify signatures — no API calls are made, so no live/secret key is required.
const stripe = new Stripe('sk_placeholder_unused', { apiVersion: '2025-02-24.acacia', typescript: true })

function extractEmail(obj: Stripe.Checkout.Session | Stripe.Invoice): string | null {
  if ('customer_details' in obj && obj.customer_details?.email) return obj.customer_details.email
  if ('customer_email' in obj && obj.customer_email) return obj.customer_email
  return null
}

export async function stripeWebhookRoutes(app: FastifyInstance) {
  // Disable body parsing for this route — Stripe signature verification requires the raw body.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body)
  )

  app.post(
    '/webhooks/stripe/:client_id',
    async (req: FastifyRequest<{ Params: { client_id: string } }>, reply: FastifyReply) => {
      const { client_id } = req.params
      const rawBody = req.body as Buffer
      const sigHeader = req.headers['stripe-signature'] as string | undefined

      const secret = await getWebhookSecret(client_id)

      let event: Stripe.Event
      if (secret && sigHeader) {
        try {
          event = stripe.webhooks.constructEvent(rawBody, sigHeader, secret)
        } catch (err) {
          app.log.warn({ err }, 'Stripe signature verification failed')
          return reply.code(401).send({ error: 'Invalid signature' })
        }
      } else {
        // No secret registered yet for this client — accept unverified (setup/testing only).
        event = JSON.parse(rawBody.toString()) as Stripe.Event
      }

      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session
          const email = extractEmail(session)
          const orderId = (session.payment_intent as string) ?? session.id
          if (email && session.amount_total != null) {
            await recordPurchase(client_id, {
              email,
              revenue: session.amount_total / 100,
              product: session.metadata?.product ?? null,
              order_id: orderId,
              processor: 'stripe',
            })
          }
          break
        }

        case 'invoice.payment_succeeded': {
          const invoice = event.data.object as Stripe.Invoice
          const email = extractEmail(invoice)
          const orderId = (invoice.payment_intent as string) ?? invoice.id
          if (email && invoice.amount_paid != null) {
            await recordPurchase(client_id, {
              email,
              revenue: invoice.amount_paid / 100,
              order_id: orderId,
              processor: 'stripe',
            })
          }
          break
        }

        case 'charge.refunded': {
          const charge = event.data.object as Stripe.Charge
          const orderId = (charge.payment_intent as string) ?? charge.id
          await recordRefund(client_id, orderId, charge.amount_refunded / 100)
          break
        }

        default:
          break
      }

      return reply.code(200).send({ received: true })
    }
  )
}
