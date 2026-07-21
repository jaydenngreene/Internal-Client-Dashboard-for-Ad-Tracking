import { FastifyInstance } from 'fastify'
import { db } from '../db'

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
}
