import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { executeReallocation } from '../lib/adBudget'

interface RawSuggestion {
  from_roas: string
  to_roas: string
  suggested_shift_amount: string
  [key: string]: unknown
}

function parseSuggestion(r: RawSuggestion) {
  return {
    ...r,
    from_roas: parseFloat(r.from_roas),
    to_roas: parseFloat(r.to_roas),
    suggested_shift_amount: parseFloat(r.suggested_shift_amount),
  }
}

// Confirm-first review surface for Step 50 — nothing here moves budget on its own
// until a human clicks Confirm, same pattern as pause_candidates (Step 35).
export async function budgetReallocationRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string }; Querystring: { status?: string } }>(
    '/clients/:id/budget-reallocations',
    async (req, reply) => {
      const status = req.query.status ?? 'pending'
      const { rows } = await db.query<RawSuggestion>(
        `SELECT * FROM budget_reallocation_suggestions WHERE client_id = $1 AND status = $2 ORDER BY created_at DESC`,
        [req.params.id, status]
      )
      return reply.send(rows.map(parseSuggestion))
    }
  )

  app.patch<{ Params: { id: string } }>('/budget-reallocations/:id/dismiss', async (req, reply) => {
    const { rows } = await db.query<RawSuggestion>(
      `UPDATE budget_reallocation_suggestions SET status = 'dismissed', resolved_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING *`,
      [req.params.id]
    )
    if (rows.length === 0) return reply.code(404).send({ error: 'Not found or not pending' })
    return reply.send(parseSuggestion(rows[0]))
  })

  app.post<{ Params: { id: string } }>('/budget-reallocations/:id/confirm', async (req, reply) => {
    const { rows } = await db.query<RawSuggestion & { client_id: string; platform: string; from_campaign_id: string; to_campaign_id: string; id: string }>(
      `SELECT * FROM budget_reallocation_suggestions WHERE id = $1 AND status = 'pending'`,
      [req.params.id]
    )
    const suggestion = rows[0]
    if (!suggestion) return reply.code(404).send({ error: 'Not found or not pending' })

    const { rows: integrationRows } = await db.query<{ config: Record<string, string> }>(
      `SELECT config FROM client_integrations WHERE client_id = $1 AND platform = $2`,
      [suggestion.client_id, suggestion.platform]
    )
    const config = integrationRows[0]?.config
    if (!config) {
      const { rows: failed } = await db.query<RawSuggestion>(
        `UPDATE budget_reallocation_suggestions SET status = 'failed', error = $2, resolved_at = NOW() WHERE id = $1 RETURNING *`,
        [suggestion.id, `No ${suggestion.platform} integration configured for this client`]
      )
      return reply.code(400).send(parseSuggestion(failed[0]))
    }

    try {
      await executeReallocation(
        suggestion.client_id,
        suggestion.platform,
        config,
        suggestion.from_campaign_id,
        suggestion.to_campaign_id,
        parseFloat(suggestion.suggested_shift_amount)
      )
      const { rows: confirmed } = await db.query<RawSuggestion>(
        `UPDATE budget_reallocation_suggestions SET status = 'confirmed', resolved_at = NOW() WHERE id = $1 RETURNING *`,
        [suggestion.id]
      )
      return reply.send(parseSuggestion(confirmed[0]))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const { rows: failed } = await db.query<RawSuggestion>(
        `UPDATE budget_reallocation_suggestions SET status = 'failed', error = $2, resolved_at = NOW() WHERE id = $1 RETURNING *`,
        [suggestion.id, message]
      )
      return reply.code(502).send(parseSuggestion(failed[0]))
    }
  })
}
