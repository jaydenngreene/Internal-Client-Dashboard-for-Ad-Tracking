import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { identifyRoutes } from '../identify'
import { db } from '../../db'
import { sendConversionSignals } from '../../lib/conversionSignals'
import { lookupVisitorId } from '../../lib/visitorResolution'
import { autoLinkByPhone, autoLinkByIp } from '../../lib/identityLinking'
import { dispatchEvent } from '../../lib/outboundWebhooks'
import { attemptRetroactiveAttribution } from '../../lib/attribution'

// /track/identify is the route documented in docs/ISSUE_LOG.md as the repeated
// source of real attribution loss (sendBeacon text/plain bug, Shopify Data-Sale
// gating, missing keepalive) — those were all client-side/transport bugs the
// server never had visibility into, but this route's own branching (validation,
// visitor resolution, the never-block-on-linking-failure guarantees, and the
// retroactive-attribution retry it added specifically for the Shopify race) had
// zero test coverage of its own before this file.

vi.mock('../../db', () => ({ db: { query: vi.fn() } }))
vi.mock('../../lib/conversionSignals', () => ({ sendConversionSignals: vi.fn() }))
vi.mock('../../lib/visitorResolution', () => ({ lookupVisitorId: vi.fn() }))
vi.mock('../../lib/identityLinking', () => ({ autoLinkByPhone: vi.fn(), autoLinkByIp: vi.fn() }))
vi.mock('../../lib/outboundWebhooks', () => ({ dispatchEvent: vi.fn() }))
vi.mock('../../lib/attribution', () => ({ attemptRetroactiveAttribution: vi.fn() }))

async function buildApp() {
  const app = Fastify()
  await app.register(identifyRoutes)
  await app.ready()
  return app
}

const dbQuery = vi.mocked(db.query)

// Sequences the 4 db.query calls the happy path makes, in order: client lookup,
// identities upsert, leads insert, most-recent-session lookup.
function mockHappyPathQueries(overrides?: { session?: { fbclid: string | null; gclid: string | null; msclkid: string | null } }) {
  dbQuery
    .mockResolvedValueOnce({ rows: [{ id: 'client-1' }] } as never)
    .mockResolvedValueOnce({ rows: [] } as never)
    .mockResolvedValueOnce({ rows: [] } as never)
    .mockResolvedValueOnce({ rows: [overrides?.session ?? { fbclid: 'fb-click-123', gclid: null, msclkid: null }] } as never)
}

describe('POST /track/identify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('400s when a required field is missing, before touching the database', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/track/identify', payload: { pixel_key: 'pk', anonymous_id: 'a1' } })
    expect(res.statusCode).toBe(400)
    expect(dbQuery).not.toHaveBeenCalled()
  })

  it('401s on an unrecognized pixel key', async () => {
    dbQuery.mockResolvedValueOnce({ rows: [] } as never)
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/track/identify',
      payload: { pixel_key: 'bad-key', anonymous_id: 'a1', email: 'a@example.com' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('404s when the visitor cannot be resolved (no cookie match, no fingerprint alias match)', async () => {
    dbQuery.mockResolvedValueOnce({ rows: [{ id: 'client-1' }] } as never)
    vi.mocked(lookupVisitorId).mockResolvedValueOnce(null)
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/track/identify',
      payload: { pixel_key: 'pk', anonymous_id: 'unknown-visitor', email: 'a@example.com' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('on success: normalizes the email, records the lead, and forwards the most recent session\'s click IDs to sendConversionSignals as a Lead event', async () => {
    vi.mocked(lookupVisitorId).mockResolvedValueOnce('visitor-1')
    mockHappyPathQueries({ session: { fbclid: 'fb-abc', gclid: null, msclkid: null } })
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/track/identify',
      payload: { pixel_key: 'pk', anonymous_id: 'a1', email: '  Real.Customer@Example.com  ' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })

    const identitiesInsert = dbQuery.mock.calls[1]
    expect(identitiesInsert[1]).toContain('real.customer@example.com')

    expect(sendConversionSignals).toHaveBeenCalledWith(
      'client-1',
      expect.objectContaining({ eventType: 'Lead', email: 'real.customer@example.com', fbclid: 'fb-abc' })
    )
    expect(dispatchEvent).toHaveBeenCalledWith('client-1', 'lead.opted.in', expect.objectContaining({ email: 'real.customer@example.com' }))
  })

  it('retries attribution for this email\'s recent purchases (the Shopify order-webhook-before-identify race, ISSUE_LOG 2026-07-25)', async () => {
    vi.mocked(lookupVisitorId).mockResolvedValueOnce('visitor-1')
    mockHappyPathQueries()
    const app = await buildApp()

    await app.inject({
      method: 'POST',
      url: '/track/identify',
      payload: { pixel_key: 'pk', anonymous_id: 'a1', email: 'buyer@example.com' },
    })

    expect(attemptRetroactiveAttribution).toHaveBeenCalledWith('client-1', 'buyer@example.com')
  })

  it('links phone to the identity only when a phone was actually provided', async () => {
    vi.mocked(lookupVisitorId).mockResolvedValueOnce('visitor-1')
    mockHappyPathQueries()
    const app = await buildApp()

    await app.inject({
      method: 'POST',
      url: '/track/identify',
      payload: { pixel_key: 'pk', anonymous_id: 'a1', email: 'buyer@example.com', phone: '+15551234567' },
    })

    expect(autoLinkByPhone).toHaveBeenCalledWith('client-1', 'buyer@example.com', '+15551234567')
    expect(autoLinkByIp).toHaveBeenCalledWith('client-1', 'buyer@example.com', 'visitor-1')
  })

  it('a cross-device linking failure does not block the 200 response (never-block guarantee)', async () => {
    vi.mocked(lookupVisitorId).mockResolvedValueOnce('visitor-1')
    mockHappyPathQueries()
    vi.mocked(autoLinkByIp).mockRejectedValueOnce(new Error('db timeout'))
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/track/identify',
      payload: { pixel_key: 'pk', anonymous_id: 'a1', email: 'buyer@example.com' },
    })

    expect(res.statusCode).toBe(200)
  })

  it('a retroactive-attribution failure does not block the 200 response (never-block guarantee)', async () => {
    vi.mocked(lookupVisitorId).mockResolvedValueOnce('visitor-1')
    mockHappyPathQueries()
    vi.mocked(attemptRetroactiveAttribution).mockRejectedValueOnce(new Error('query failed'))
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/track/identify',
      payload: { pixel_key: 'pk', anonymous_id: 'a1', email: 'buyer@example.com' },
    })

    expect(res.statusCode).toBe(200)
  })
})
