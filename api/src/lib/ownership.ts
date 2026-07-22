import { FastifyRequest, FastifyReply } from 'fastify'
import { db } from '../db'

// Step 54 — the resolved client id is stashed here so the generic audit-log
// onResponse hook (index.ts) can log which client a mutation touched without
// re-running the same resolver lookup a second time after the handler runs.
declare module 'fastify' {
  interface FastifyRequest {
    auditClientId?: string | null
  }
}

type Resolver = 'client' | 'skip' | ((req: FastifyRequest) => Promise<string | null>)

async function clientIdFrom(table: string, idColumn: string, idValue: string): Promise<string | null> {
  const { rows } = await db.query<{ client_id: string }>(`SELECT client_id FROM ${table} WHERE ${idColumn} = $1`, [
    idValue,
  ])
  return rows[0]?.client_id ?? null
}

// Every dashboard-facing route, keyed by its registered path pattern (method-
// agnostic — every verb on the same path shares the same ownership semantics
// here). 'client' means the :id path param IS the client id, so it's checked
// directly. 'skip' means the route has no single client id to check (create/list/
// agency-aggregate) and scopes itself explicitly in its own handler instead. A
// function means the id in the path belongs to some OTHER row (a call, a tag, a
// webhook subscription...) — one extra lookup finds which client actually owns it.
// This table is deliberately exhaustive and explicit rather than pattern-matched,
// so a new route added later without an entry here fails closed (see the fallback
// in requireOwnership below) instead of silently going unprotected.
export const RESOLVERS: Record<string, Resolver> = {
  '/clients': 'skip',
  '/clients/:id': 'client',
  '/clients/:id/attribution-model': 'client',
  '/clients/:id/niche': 'client',
  '/clients/:id/margin': 'client',
  '/clients/:id/share-link': 'client',
  '/clients/:id/utm-mismatches': 'client',
  '/clients/:id/budget-target': 'client',
  '/clients/:id/currency': 'client',
  '/clients/:id/report-schedule': 'client',
  '/clients/:id/branding': 'client',
  '/clients/:id/audit-log': 'client',
  '/account/audit-log': 'skip',
  '/clients/:id/identity-links': 'client',
  '/clients/:id/tracking-numbers': 'client',
  '/clients/:id/webhook-subscriptions': 'client',
  '/clients/:id/integrations': 'client',
  '/clients/:id/integrations/shopify': 'client',
  '/clients/:id/integrations/stripe': 'client',
  '/clients/:id/integrations/facebook-ads': 'client',
  '/clients/:id/integrations/google-ads': 'client',
  '/clients/:id/integrations/facebook-capi': 'client',
  '/clients/:id/integrations/bing-ads': 'client',
  '/clients/:id/integrations/twilio': 'client',
  '/clients/:id/integrations/alerts': 'client',
  '/clients/:id/integrations/paypal': 'client',
  '/clients/:id/integrations/square': 'client',
  '/clients/:id/integrations/gohighlevel': 'client',
  '/clients/:id/integrations/tiktok-ads': 'client',
  '/clients/:id/integrations/snapchat-ads': 'client',
  '/clients/:id/integrations/pinterest-ads': 'client',
  '/clients/:id/integrations/linkedin-ads': 'client',
  '/clients/:id/integrations/reddit-ads': 'client',
  '/clients/:id/integrations/customers-ai': 'client',
  '/clients/:id/integrations/klaviyo': 'client',
  '/clients/:id/integrations/bigquery': 'client',
  '/clients/:id/integrations/tag-webhook/generate': 'client',
  '/clients/:id/reports/overview': 'client',
  '/clients/:id/reports/bof': 'client',
  '/clients/:id/reports/mof': 'client',
  '/clients/:id/reports/leads': 'client',
  '/clients/:id/reports/ltv': 'client',
  '/clients/:id/reports/funnel': 'client',
  '/clients/:id/reports/calls': 'client',
  '/clients/:id/reports/cohorts': 'client',
  '/clients/:id/reports/budget-pacing': 'client',
  '/clients/:id/reports/email-sms': 'client',
  '/clients/:id/reports/forecast': 'client',
  '/clients/:id/reports/mmm': 'client',
  '/clients/:id/reports/markov-attribution': 'client',
  '/clients/:id/reports/invalid-traffic': 'client',
  '/clients/:id/reports/subscriptions': 'client',
  '/clients/:id/campaigns/:platform/:campaignName': 'client',
  '/clients/:id/campaigns/:platform/:campaignName/creatives/:creativeName': 'client',
  '/clients/:id/tags': 'client',
  '/clients/:id/leads/:email/tags': 'client',
  '/clients/:id/leads/:email/tags/:tagId': 'client',
  '/clients/:id/leads/:email/journey': 'client',
  '/clients/:id/custom-costs': 'client',
  '/clients/:id/audience-syncs': 'client',
  '/clients/:id/insights': 'client',
  '/clients/:id/insights/regenerate': 'client',
  '/clients/:id/collaborators': 'client',
  '/clients/:id/collaborators/:userId': 'client',
  '/clients/:id/remarketing/candidates': 'client',
  '/clients/:id/pause-candidates': 'client',
  '/clients/:id/incrementality-tests': 'client',
  '/clients/:id/creative-fatigue': 'client',
  '/clients/:id/budget-reallocations': 'client',
  '/clients/:id/chat': 'client',
  '/clients/:id/geo-lift-tests': 'client',
  '/reports/agency-overview': 'skip',
  '/jobs/status': 'skip',

  '/webhook-subscriptions/:subId': (req) =>
    clientIdFrom('outbound_webhook_subscriptions', 'id', (req.params as { subId: string }).subId),
  '/custom-costs/:costId': (req) => clientIdFrom('custom_costs', 'id', (req.params as { costId: string }).costId),
  '/audience-syncs/:syncId/run': (req) =>
    clientIdFrom('audience_syncs', 'id', (req.params as { syncId: string }).syncId),
  '/calls/:id/qualified': (req) => clientIdFrom('calls', 'id', (req.params as { id: string }).id),
  '/calls/:id/qualification': (req) => clientIdFrom('calls', 'id', (req.params as { id: string }).id),
  '/remarketing/:id/approve': (req) => clientIdFrom('remarketing_candidates', 'id', (req.params as { id: string }).id),
  '/remarketing/:id/reject': (req) => clientIdFrom('remarketing_candidates', 'id', (req.params as { id: string }).id),
  '/remarketing/:id/dispatch': (req) => clientIdFrom('remarketing_candidates', 'id', (req.params as { id: string }).id),
  '/pause-candidates/:id/confirm': (req) => clientIdFrom('pause_candidates', 'id', (req.params as { id: string }).id),
  '/pause-candidates/:id/dismiss': (req) => clientIdFrom('pause_candidates', 'id', (req.params as { id: string }).id),
  '/incrementality-tests/:testId': (req) =>
    clientIdFrom('incrementality_tests', 'id', (req.params as { testId: string }).testId),
  '/geo-lift-tests/:testId': (req) =>
    clientIdFrom('geo_lift_tests', 'id', (req.params as { testId: string }).testId),
  '/creative-fatigue/:id/dismiss': (req) =>
    clientIdFrom('creative_fatigue_signals', 'id', (req.params as { id: string }).id),
  '/budget-reallocations/:id/confirm': (req) =>
    clientIdFrom('budget_reallocation_suggestions', 'id', (req.params as { id: string }).id),
  '/budget-reallocations/:id/dismiss': (req) =>
    clientIdFrom('budget_reallocation_suggestions', 'id', (req.params as { id: string }).id),
  '/tags/:tagId': (req) => clientIdFrom('tags', 'id', (req.params as { tagId: string }).tagId),
}

// True if this user owns the client OR is a collaborator on it (migration 028) —
// collaborators get the exact same data access as the owner everywhere this gate
// is checked; only the owner-only routes below (collaborator management, client
// deletion) additionally check ownership specifically, on top of this.
async function hasClientAccess(clientId: string, userId: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM clients WHERE id = $1 AND (
       owner_user_id = $2
       OR EXISTS (SELECT 1 FROM client_collaborators WHERE client_id = $1 AND user_id = $2)
     )`,
    [clientId, userId]
  )
  return rows.length > 0
}

// Stricter than hasClientAccess above — only the actual owner, never a collaborator.
// Route handlers call this themselves for the handful of actions collaborators
// shouldn't get: deleting the client outright, and managing who else has access.
export async function isClientOwner(clientId: string, userId: string): Promise<boolean> {
  const { rows } = await db.query('SELECT 1 FROM clients WHERE id = $1 AND owner_user_id = $2', [clientId, userId])
  return rows.length > 0
}

// Runs after authenticate() (req.userId is already set). Looks up this route's
// resolver by its registered path; a path with no entry here fails closed with a
// 500 rather than silently allowing the request through unscoped.
export async function requireOwnership(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const path = req.routeOptions.url
  const resolver = path ? RESOLVERS[path] : undefined

  if (resolver === undefined) {
    req.log.error(`No ownership resolver registered for route: ${path}`)
    return reply.code(500).send({ error: 'Server misconfiguration' })
  }
  if (resolver === 'skip') return

  const clientId = resolver === 'client' ? (req.params as { id: string }).id : await resolver(req)
  req.auditClientId = clientId

  if (!clientId || !(await hasClientAccess(clientId, req.userId!))) {
    return reply.code(404).send({ error: 'Not found' })
  }
}
