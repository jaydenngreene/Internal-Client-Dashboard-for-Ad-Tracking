import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { goHighLevelWebhookRoutes } from '../gohighlevel'
import { db } from '../../../db'
import { recordPurchase, recordRefund } from '../../../lib/attribution'
import { autoLinkByPhone } from '../../../lib/identityLinking'

// GHL has no fixed payment-webhook schema or platform-level signing the way
// Shopify/Square/Stripe do (docs/ISSUE_LOG.md) — this route's only defense is
// the shared-secret check, and its "unverified-and-accepted while no integration
// is configured yet" bootstrap behavior is exactly the kind of thing that's easy
// to get backwards without a test (accepting a request when a secret *should*
// have been required, or the reverse). Zero coverage existed before this file.

vi.mock('../../../db', () => ({ db: { query: vi.fn() } }))
vi.mock('../../../lib/attribution', () => ({ recordPurchase: vi.fn(), recordRefund: vi.fn() }))
vi.mock('../../../lib/identityLinking', () => ({ autoLinkByPhone: vi.fn() }))

const dbQuery = vi.mocked(db.query)

async function buildApp() {
  const app = Fastify()
  await app.register(goHighLevelWebhookRoutes)
  await app.ready()
  return app
}

function mockIntegration(config: { webhook_secret: string } | null) {
  dbQuery.mockResolvedValueOnce({ rows: config ? [{ config }] : [] } as never)
}

describe('POST /webhooks/gohighlevel/:client_id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('401s on a wrong secret when an integration is configured, and never calls recordPurchase', async () => {
    mockIntegration({ webhook_secret: 'correct-secret' })
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/gohighlevel/client-1',
      payload: { secret: 'wrong-secret', event: 'charge', contact: { email: 'lead@example.com' }, amount: 100 },
    })

    expect(res.statusCode).toBe(401)
    expect(recordPurchase).not.toHaveBeenCalled()
  })

  it('accepts any secret while no integration is configured yet (bootstrap convention, matches Shopify/Stripe)', async () => {
    mockIntegration(null)
    dbQuery.mockResolvedValueOnce({ rows: [] } as never) // the identities UPDATE, only reached if phone+email both present — not here
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/gohighlevel/client-1',
      payload: { secret: 'anything-at-all', event: 'charge', contact: { email: 'lead@example.com' }, amount: 250 },
    })

    expect(res.statusCode).toBe(200)
    expect(recordPurchase).toHaveBeenCalledWith('client-1', {
      email: 'lead@example.com',
      revenue: 250,
      order_id: undefined,
      processor: 'gohighlevel',
    })
  })

  it('records a charge as a purchase, preferring contact.email/phone over top-level fields', async () => {
    mockIntegration({ webhook_secret: 's3cret' })
    const app = await buildApp()

    await app.inject({
      method: 'POST',
      url: '/webhooks/gohighlevel/client-1',
      payload: {
        secret: 's3cret',
        event: 'charge',
        contact: { email: 'contact-email@example.com' },
        email: 'fallback@example.com',
        amount: 99.5,
        transaction_id: 'txn-1',
      },
    })

    expect(recordPurchase).toHaveBeenCalledWith('client-1', {
      email: 'contact-email@example.com',
      revenue: 99.5,
      order_id: 'txn-1',
      processor: 'gohighlevel',
    })
  })

  it('records a refund via recordRefund, not recordPurchase', async () => {
    mockIntegration({ webhook_secret: 's3cret' })
    const app = await buildApp()

    await app.inject({
      method: 'POST',
      url: '/webhooks/gohighlevel/client-1',
      payload: { secret: 's3cret', event: 'refund', order_id: 'txn-1', amount: 99.5 },
    })

    expect(recordRefund).toHaveBeenCalledWith('client-1', 'txn-1', 99.5)
    expect(recordPurchase).not.toHaveBeenCalled()
  })

  it('silently no-ops (still 200) when amount is zero or email is missing, rather than recording a bad row', async () => {
    mockIntegration({ webhook_secret: 's3cret' })
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/gohighlevel/client-1',
      payload: { secret: 's3cret', event: 'charge', amount: 0 },
    })

    expect(res.statusCode).toBe(200)
    expect(recordPurchase).not.toHaveBeenCalled()
  })

  it('links phone to an existing identity when both email and phone are present, and a linking failure does not block the 200', async () => {
    mockIntegration({ webhook_secret: 's3cret' })
    dbQuery.mockResolvedValueOnce({ rows: [] } as never) // the identities UPDATE
    vi.mocked(autoLinkByPhone).mockRejectedValueOnce(new Error('db timeout'))
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/gohighlevel/client-1',
      payload: { secret: 's3cret', event: 'charge', contact: { email: 'Lead@Example.com', phone: '+15551234567' }, amount: 50 },
    })

    expect(res.statusCode).toBe(200)
    expect(autoLinkByPhone).toHaveBeenCalledWith('client-1', 'lead@example.com', '+15551234567')
  })

  it('does not attempt phone linking when only one of email/phone is present', async () => {
    mockIntegration({ webhook_secret: 's3cret' })
    const app = await buildApp()

    await app.inject({
      method: 'POST',
      url: '/webhooks/gohighlevel/client-1',
      payload: { secret: 's3cret', event: 'charge', contact: { email: 'lead@example.com' }, amount: 50 },
    })

    expect(autoLinkByPhone).not.toHaveBeenCalled()
  })
})
