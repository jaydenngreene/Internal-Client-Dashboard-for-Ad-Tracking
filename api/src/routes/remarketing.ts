import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { addToKlaviyoList } from '../lib/klaviyoDispatch'

// Human review surface for Step 12 (AI remarketing agent). Approve/reject only mark
// review state — they never send anything. Dispatch is a separate, deliberate action
// (see POST /remarketing/:id/dispatch below) so nothing in the dashboard's default
// review flow can accidentally message a real lead.
export async function remarketingRoutes(app: FastifyInstance) {
  app.get<{
    Params: { id: string }
    Querystring: { status?: string }
  }>('/clients/:id/remarketing/candidates', async (req, reply) => {
    const { id } = req.params
    const status = req.query.status ?? 'pending'
    const { rows } = await db.query(
      `SELECT * FROM remarketing_candidates
       WHERE client_id = $1 AND status = $2
       ORDER BY identified_at DESC`,
      [id, status]
    )
    return reply.send(rows)
  })

  app.patch<{ Params: { id: string } }>('/remarketing/:id/approve', async (req, reply) => {
    const { rows } = await db.query(
      `UPDATE remarketing_candidates
       SET status = 'approved', reviewed_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [req.params.id]
    )
    if (rows.length === 0) return reply.code(404).send({ error: 'Not found or not pending' })
    return reply.send(rows[0])
  })

  app.patch<{ Params: { id: string } }>('/remarketing/:id/reject', async (req, reply) => {
    const { rows } = await db.query(
      `UPDATE remarketing_candidates
       SET status = 'rejected', reviewed_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [req.params.id]
    )
    if (rows.length === 0) return reply.code(404).send({ error: 'Not found or not pending' })
    return reply.send(rows[0])
  })

  // The one endpoint that reaches a real ESP. Only callable on an already-approved
  // candidate, and only adds them to a Klaviyo list (see lib/klaviyoDispatch.ts) — it
  // does not trigger a send itself. Not called from anywhere in the dashboard UI yet;
  // this is intentionally a manual, explicit call until live sends are approved.
  app.post<{ Params: { id: string } }>('/remarketing/:id/dispatch', async (req, reply) => {
    const { rows } = await db.query(
      `SELECT * FROM remarketing_candidates WHERE id = $1 AND status = 'approved'`,
      [req.params.id]
    )
    const candidate = rows[0]
    if (!candidate) return reply.code(404).send({ error: 'Not found or not approved' })

    try {
      const result = await addToKlaviyoList(candidate.client_id, {
        email: candidate.email,
        phone: candidate.phone,
        firstName: candidate.first_name,
        lastName: candidate.last_name,
      })
      const { rows: updated } = await db.query(
        `UPDATE remarketing_candidates SET status = 'dispatched', dispatched_at = NOW() WHERE id = $1 RETURNING *`,
        [req.params.id]
      )
      return reply.send({ ...updated[0], klaviyo_profile_id: result.profileId })
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })
}
