import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { generateInsights } from '../lib/insightsAgent'

// On-demand + cached, not a nightly background job — the user explicitly chose this
// over a cron: cheap (no wasted API spend on clients nobody's looking at that day),
// and generated_at makes staleness visible instead of silently refreshing overnight.
export async function insightsRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/clients/:id/insights', async (req, reply) => {
    const { rows } = await db.query(
      `SELECT client_id, generated_at, insights, model, error FROM client_insights WHERE client_id = $1`,
      [req.params.id]
    )
    if (rows.length === 0) return reply.send(null)
    return reply.send(rows[0])
  })

  app.post<{ Params: { id: string } }>('/clients/:id/insights/regenerate', async (req, reply) => {
    const { id } = req.params
    try {
      const insights = await generateInsights(id)
      const { rows } = await db.query(
        `INSERT INTO client_insights (client_id, generated_at, insights, model, error)
         VALUES ($1, NOW(), $2, 'claude-opus-4-8', NULL)
         ON CONFLICT (client_id) DO UPDATE SET generated_at = NOW(), insights = EXCLUDED.insights, model = EXCLUDED.model, error = NULL
         RETURNING client_id, generated_at, insights, model, error`,
        [id, JSON.stringify(insights)]
      )
      return reply.send(rows[0])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const { rows } = await db.query(
        `INSERT INTO client_insights (client_id, generated_at, insights, model, error)
         VALUES ($1, NOW(), '[]'::jsonb, 'claude-opus-4-8', $2)
         ON CONFLICT (client_id) DO UPDATE SET generated_at = NOW(), error = EXCLUDED.error
         RETURNING client_id, generated_at, insights, model, error`,
        [id, message]
      )
      return reply.code(502).send(rows[0])
    }
  })
}
