import { describe, it, expect } from 'vitest'
import { RESOLVERS } from '../ownership'

// The whole point of RESOLVERS being an explicit, exhaustive table (not a
// pattern-matcher) is that requireOwnership() fails closed with a 500 for any
// route with no entry. This test doesn't re-verify the runtime behavior (that's
// covered by the live isolation testing done when auth was built), but it does
// guard the table's shape — a real regression here (someone accidentally
// deleting an entry, or adding one with a typo'd strategy value) would silently
// reopen a route to other users' data.
describe('ownership resolver table', () => {
  it('is non-empty', () => {
    expect(Object.keys(RESOLVERS).length).toBeGreaterThan(0)
  })

  it('every entry is a valid strategy: "client", "skip", or a function', () => {
    for (const [path, resolver] of Object.entries(RESOLVERS)) {
      const isValid = resolver === 'client' || resolver === 'skip' || typeof resolver === 'function'
      expect(isValid, `${path} has an invalid resolver strategy: ${String(resolver)}`).toBe(true)
    }
  })

  it('has bespoke (non-"client") resolvers for every route whose :id is NOT the client id', () => {
    // These are the routes identified during the auth audit as needing a lookup
    // through some other row (a tag, a call, a webhook subscription, a
    // remarketing candidate, a custom cost, an audience sync) to find the owning
    // client — if any of these regress to 'client', ownership would be checked
    // against the wrong id and either wrongly block or wrongly allow access.
    const bespokeRoutes = [
      '/webhook-subscriptions/:subId',
      '/custom-costs/:costId',
      '/audience-syncs/:syncId/run',
      '/calls/:id/qualified',
      '/calls/:id/qualification',
      '/remarketing/:id/approve',
      '/remarketing/:id/reject',
      '/remarketing/:id/dispatch',
      '/tags/:tagId',
    ]
    for (const route of bespokeRoutes) {
      expect(typeof RESOLVERS[route], `${route} should have a function resolver`).toBe('function')
    }
  })

  it('has a "skip" resolver for the two create/list-all routes with no single client id', () => {
    expect(RESOLVERS['/clients']).toBe('skip')
    expect(RESOLVERS['/reports/agency-overview']).toBe('skip')
  })
})
