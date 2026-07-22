import { FastifyInstance } from 'fastify'
import { db } from '../db'

// Manual ad-spend entry for platforms this app has no native cost-sync integration
// for (native ad networks, sponsorships, etc) — Step 26. One row per (client, label,
// date); re-posting the same label/date upserts rather than duplicating.
export async function customCostsRoutes(app: FastifyInstance) {
  app.post<{
    Params: { id: string }
    Body: { platform_label: string; date: string; spend: number; notes?: string }
  }>('/clients/:id/custom-costs', async (req, reply) => {
    const { id } = req.params
    const { platform_label, date, spend, notes } = req.body

    if (!platform_label || !date || typeof spend !== 'number') {
      return reply.code(400).send({ error: 'platform_label, date, and spend required' })
    }

    const { rows } = await db.query(
      `INSERT INTO custom_costs (client_id, platform_label, date, spend, notes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (client_id, platform_label, date)
       DO UPDATE SET spend = EXCLUDED.spend, notes = EXCLUDED.notes
       RETURNING *`,
      [id, platform_label, date, spend, notes ?? null]
    )
    return reply.code(200).send({ ...rows[0], spend: parseFloat(rows[0].spend) })
  })

  app.get<{
    Params: { id: string }
    Querystring: { from?: string; to?: string }
  }>('/clients/:id/custom-costs', async (req, reply) => {
    const { id } = req.params
    const { from, to } = req.query
    const { rows } = await db.query(
      `SELECT * FROM custom_costs
       WHERE client_id = $1 AND ($2::date IS NULL OR date >= $2) AND ($3::date IS NULL OR date <= $3)
       ORDER BY date DESC`,
      [id, from ?? null, to ?? null]
    )
    // spend is NUMERIC in Postgres, which node-postgres returns as a string —
    // every other report route in this app parses it before responding, this one
    // didn't.
    return reply.send(rows.map((r) => ({ ...r, spend: parseFloat(r.spend) })))
  })

  app.delete<{ Params: { costId: string } }>('/custom-costs/:costId', async (req, reply) => {
    const { rows } = await db.query('DELETE FROM custom_costs WHERE id = $1 RETURNING id', [req.params.costId])
    if (rows.length === 0) return reply.code(404).send({ error: 'Not found' })
    return reply.code(204).send()
  })
}
