import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import Stripe from 'stripe'
import { db } from '../../db'
import { recordPurchase, recordRefund } from '../../lib/attribution'
import { upsertSubscription, SubscriptionStatus } from '../../lib/subscriptions'

// Stripe subscription webhooks don't carry the customer's email directly (only a
// customer id) — checkout.session.completed does, for the checkout that created the
// subscription, so that event backfills email onto whichever row already exists. If
// customer.subscription.created arrives first (no row yet), this is a no-op; the
// email arrives moments later from the checkout event, or via metadata.email if the
// merchant's checkout flow sets it there directly (a common real-world convention).
async function backfillSubscriptionEmail(clientId: string, externalSubscriptionId: string, email: string): Promise<void> {
  await db.query(
    `UPDATE subscriptions SET email = COALESCE(email, $1)
     WHERE client_id = $2 AND processor = 'stripe' AND external_subscription_id = $3`,
    [email, clientId, externalSubscriptionId]
  )
}

// Sums recurring price items, normalized to a monthly amount — Stripe subscriptions
// can have annual/weekly/daily intervals, MRR needs them all on one common basis.
function computeMrr(sub: Stripe.Subscription): number {
  let total = 0
  for (const item of sub.items.data) {
    const price = item.price
    if (!price.unit_amount || !price.recurring) continue
    const amount = (price.unit_amount / 100) * (item.quantity ?? 1)
    const intervalCount = price.recurring.interval_count ?? 1
    switch (price.recurring.interval) {
      case 'year':
        total += amount / (12 * intervalCount)
        break
      case 'month':
        total += amount / intervalCount
        break
      case 'week':
        total += (amount * 52) / (12 * intervalCount)
        break
      case 'day':
        total += (amount * 365) / (12 * intervalCount)
        break
    }
  }
  return total
}

function unixToDate(unix: number | null | undefined): Date | null {
  return unix ? new Date(unix * 1000) : null
}

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
              currency: session.currency?.toUpperCase(),
            })
          }
          // Step 21 — subscription checkouts don't carry the subscription's own
          // status/MRR here, just the link between it and the email that just paid.
          if (email && session.mode === 'subscription' && session.subscription) {
            await backfillSubscriptionEmail(client_id, session.subscription as string, email)
          }
          break
        }

        // Step 21 — Subscription lifecycle. mrr_amount/status/dates come straight off
        // the Subscription object; email is whatever's already on file (backfilled by
        // checkout.session.completed above, or metadata.email if the merchant's
        // checkout flow sets it there).
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted': {
          const sub = event.data.object as Stripe.Subscription
          await upsertSubscription(client_id, {
            email: (sub.metadata?.email as string | undefined) ?? null,
            processor: 'stripe',
            externalSubscriptionId: sub.id,
            planName: sub.items.data[0]?.price?.nickname ?? null,
            status: (event.type === 'customer.subscription.deleted' ? 'canceled' : sub.status) as SubscriptionStatus,
            mrrAmount: event.type === 'customer.subscription.deleted' ? 0 : computeMrr(sub),
            currency: sub.currency?.toUpperCase(),
            trialEndsAt: unixToDate(sub.trial_end),
            currentPeriodEnd: unixToDate(sub.current_period_end),
            startedAt: unixToDate(sub.start_date),
            canceledAt: unixToDate(sub.canceled_at),
          })
          break
        }

        // Informational only (fired a few days before a trial ends) — not a status
        // transition itself, nothing to record.
        case 'customer.subscription.trial_will_end':
          break

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
              currency: invoice.currency?.toUpperCase(),
            })
          }
          break
        }

        case 'charge.refunded': {
          const charge = event.data.object as Stripe.Charge
          const orderId = (charge.payment_intent as string) ?? charge.id
          await recordRefund(client_id, orderId, charge.amount_refunded / 100, charge.currency?.toUpperCase())
          break
        }

        default:
          break
      }

      return reply.code(200).send({ received: true })
    }
  )
}
