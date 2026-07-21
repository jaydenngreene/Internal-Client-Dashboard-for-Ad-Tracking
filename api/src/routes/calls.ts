import { FastifyInstance } from 'fastify'
import { db } from '../db'

const DISPOSITIONS = ['new_lead', 'qualified', 'unqualified', 'existing_customer', 'wrong_number', 'voicemail', 'spam']

// Call quality/qualification isn't something we can infer automatically (that would
// need speech analysis of the recording) — this just lets whoever's reviewing calls
// tag them, same spirit as a CRM's manual lead-qualification field.
export async function callRoutes(app: FastifyInstance) {
  app.patch<{ Params: { id: string }; Body: { qualified: boolean } }>('/calls/:id/qualified', async (req, reply) => {
    const { qualified } = req.body
    if (typeof qualified !== 'boolean') {
      return reply.code(400).send({ error: 'qualified must be a boolean' })
    }
    const { rows } = await db.query('UPDATE calls SET qualified = $1 WHERE id = $2 RETURNING *', [
      qualified,
      req.params.id,
    ])
    if (rows.length === 0) return reply.code(404).send({ error: 'Not found' })
    return reply.send(rows[0])
  })

  // Step 23 — continuous score + disposition taxonomy, richer than the plain boolean
  // above. Deriving `qualified` from the score (>= 0.5) when a score is given keeps
  // the existing boolean-based qualified-rate math in /reports/calls working
  // unchanged for callers that only ever set a score, not the boolean directly.
  app.patch<{
    Params: { id: string }
    Body: { qualification_score?: number; disposition?: string }
  }>('/calls/:id/qualification', async (req, reply) => {
    const { qualification_score, disposition } = req.body

    if (qualification_score === undefined && disposition === undefined) {
      return reply.code(400).send({ error: 'qualification_score and/or disposition required' })
    }
    if (qualification_score !== undefined && (typeof qualification_score !== 'number' || qualification_score < 0 || qualification_score > 1)) {
      return reply.code(400).send({ error: 'qualification_score must be a number between 0 and 1' })
    }
    if (disposition !== undefined && !DISPOSITIONS.includes(disposition)) {
      return reply.code(400).send({ error: `disposition must be one of: ${DISPOSITIONS.join(', ')}` })
    }

    const { rows } = await db.query(
      `UPDATE calls
       SET qualification_score = COALESCE($1, qualification_score),
           disposition = COALESCE($2, disposition),
           qualified = CASE WHEN $1 IS NOT NULL THEN $1 >= 0.5 ELSE qualified END
       WHERE id = $3
       RETURNING *`,
      [qualification_score ?? null, disposition ?? null, req.params.id]
    )
    if (rows.length === 0) return reply.code(404).send({ error: 'Not found' })
    return reply.send(rows[0])
  })
}
