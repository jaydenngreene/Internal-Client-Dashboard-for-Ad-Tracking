import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { generateInsights, InsightScope } from '../lib/insightsAgent'

interface ScopeQuery {
  scope?: 'client' | 'platform' | 'campaign' | 'creative'
  platform?: string
  campaign?: string
  creative?: string
}

function parseScope(q: ScopeQuery): InsightScope {
  if (q.scope === 'platform' && q.platform) {
    return { type: 'platform', platform: q.platform }
  }
  if (q.scope === 'campaign' && q.platform && q.campaign) {
    return { type: 'campaign', platform: q.platform, campaignName: q.campaign }
  }
  if (q.scope === 'creative' && q.platform && q.campaign && q.creative) {
    return { type: 'creative', platform: q.platform, campaignName: q.campaign, creativeName: q.creative }
  }
  return { type: 'client' }
}

// scope_key folds campaign+creative together for the creative scope since a creative
// name alone isn't unique across campaigns — matches how the unique index in migration
// 025 was built to key on (client_id, scope_type, scope_platform, scope_key). Platform
// scope (migration 026) needs no key at all, same "no key" convention the client scope
// already uses — scope_platform alone is unique per client there.
function scopeColumns(scope: InsightScope): { scopeType: string; scopePlatform: string | null; scopeKey: string | null } {
  if (scope.type === 'platform') return { scopeType: 'platform', scopePlatform: scope.platform, scopeKey: null }
  if (scope.type === 'campaign') return { scopeType: 'campaign', scopePlatform: scope.platform, scopeKey: scope.campaignName }
  if (scope.type === 'creative')
    return {
      scopeType: 'creative',
      scopePlatform: scope.platform,
      scopeKey: `${scope.campaignName}::${scope.creativeName}`,
    }
  return { scopeType: 'client', scopePlatform: null, scopeKey: null }
}

// On-demand + cached, not a nightly background job — the user explicitly chose this
// over a cron: cheap (no wasted API spend on clients nobody's looking at that day),
// and generated_at makes staleness visible instead of silently refreshing overnight.
// Generalized (migration 025) to also cover one row per campaign/creative, selected via
// ?scope=campaign&platform=...&campaign=... or ?scope=creative&...&creative=... — no
// query params at all still means the original whole-account client-level insight.
export async function insightsRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string }; Querystring: ScopeQuery }>('/clients/:id/insights', async (req, reply) => {
    const scope = parseScope(req.query)
    const { scopeType, scopePlatform, scopeKey } = scopeColumns(scope)
    const { rows } = await db.query(
      `SELECT client_id, generated_at, insights, model, error, scope_type, scope_platform, scope_key
       FROM client_insights
       WHERE client_id = $1 AND scope_type = $2
         AND COALESCE(scope_platform, '') = COALESCE($3, '')
         AND COALESCE(scope_key, '') = COALESCE($4, '')`,
      [req.params.id, scopeType, scopePlatform, scopeKey]
    )
    if (rows.length === 0) return reply.send(null)
    return reply.send(rows[0])
  })

  app.post<{ Params: { id: string }; Querystring: ScopeQuery }>('/clients/:id/insights/regenerate', async (req, reply) => {
    const { id } = req.params
    const scope = parseScope(req.query)
    const { scopeType, scopePlatform, scopeKey } = scopeColumns(scope)
    try {
      const insights = await generateInsights(id, scope)
      const { rows } = await db.query(
        `INSERT INTO client_insights (client_id, generated_at, insights, model, error, scope_type, scope_platform, scope_key)
         VALUES ($1, NOW(), $2, 'claude-opus-4-8', NULL, $3, $4, $5)
         ON CONFLICT (client_id, scope_type, COALESCE(scope_platform, ''), COALESCE(scope_key, ''))
         DO UPDATE SET generated_at = NOW(), insights = EXCLUDED.insights, model = EXCLUDED.model, error = NULL
         RETURNING client_id, generated_at, insights, model, error, scope_type, scope_platform, scope_key`,
        [id, JSON.stringify(insights), scopeType, scopePlatform, scopeKey]
      )
      return reply.send(rows[0])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const { rows } = await db.query(
        `INSERT INTO client_insights (client_id, generated_at, insights, model, error, scope_type, scope_platform, scope_key)
         VALUES ($1, NOW(), '[]'::jsonb, 'claude-opus-4-8', $2, $3, $4, $5)
         ON CONFLICT (client_id, scope_type, COALESCE(scope_platform, ''), COALESCE(scope_key, ''))
         DO UPDATE SET generated_at = NOW(), error = EXCLUDED.error
         RETURNING client_id, generated_at, insights, model, error, scope_type, scope_platform, scope_key`,
        [id, message, scopeType, scopePlatform, scopeKey]
      )
      return reply.code(502).send(rows[0])
    }
  })
}
