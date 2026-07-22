import { FastifyInstance } from 'fastify'
import { db } from '../db'

// Advisory-only creative fatigue signals (Step 47) — no confirm-and-pause action
// like pause_candidates has, this is purely "consider refreshing this creative,"
// left to the user to act on however they see fit.
export async function creativeFatigueRoutes(app: FastifyInstance) {
  app.get<{
    Params: { id: string }
    Querystring: { status?: string }
  }>('/clients/:id/creative-fatigue', async (req, reply) => {
    const status = req.query.status ?? 'active'
    const { rows } = await db.query<{ recent_ctr: string; prior_ctr: string; decline_pct: string; [key: string]: unknown }>(
      `SELECT * FROM creative_fatigue_signals WHERE client_id = $1 AND status = $2 ORDER BY created_at DESC`,
      [req.params.id, status]
    )
    return reply.send(
      rows.map((r) => ({
        ...r,
        recent_ctr: parseFloat(r.recent_ctr),
        prior_ctr: parseFloat(r.prior_ctr),
        decline_pct: parseFloat(r.decline_pct),
      }))
    )
  })

  app.patch<{ Params: { id: string } }>('/creative-fatigue/:id/dismiss', async (req, reply) => {
    const { rows } = await db.query<{ recent_ctr: string; prior_ctr: string; decline_pct: string; [key: string]: unknown }>(
      `UPDATE creative_fatigue_signals SET status = 'dismissed', resolved_at = NOW() WHERE id = $1 AND status = 'active' RETURNING *`,
      [req.params.id]
    )
    if (rows.length === 0) return reply.code(404).send({ error: 'Not found or not active' })
    const r = rows[0]
    return reply.send({ ...r, recent_ctr: parseFloat(r.recent_ctr), prior_ctr: parseFloat(r.prior_ctr), decline_pct: parseFloat(r.decline_pct) })
  })
}
