import { FastifyInstance } from 'fastify'
import { db } from '../db'

// Advisory-only, same pattern as creativeFatigue.ts — no confirm-and-act flow,
// just "here's what might be broken, dismiss it once you've checked."
export async function trackingHealthRoutes(app: FastifyInstance) {
  app.get<{
    Params: { id: string }
    Querystring: { status?: string }
  }>('/clients/:id/tracking-health', async (req, reply) => {
    const status = req.query.status ?? 'active'
    const { rows } = await db.query(
      `SELECT * FROM tracking_health_signals WHERE client_id = $1 AND status = $2 ORDER BY created_at DESC`,
      [req.params.id, status]
    )
    return reply.send(rows)
  })

  app.patch<{ Params: { id: string } }>('/tracking-health/:id/dismiss', async (req, reply) => {
    const { rows } = await db.query(
      `UPDATE tracking_health_signals SET status = 'dismissed', resolved_at = NOW() WHERE id = $1 AND status = 'active' RETURNING *`,
      [req.params.id]
    )
    if (rows.length === 0) return reply.code(404).send({ error: 'Not found or not active' })
    return reply.send(rows[0])
  })
}
