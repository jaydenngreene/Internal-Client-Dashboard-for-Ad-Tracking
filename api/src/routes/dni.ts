import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { lookupVisitorId } from '../lib/visitorResolution'

interface DniBody {
  pixel_key: string
  anonymous_id: string
}

// Dynamic Number Insertion: assigns this visitor a tracking phone number from the
// client's pool so an inbound call to it can be traced back to the session that
// generated it. Session-sticky (a visitor keeps the same number across page loads)
// and numbers recycle back into the pool after 30 minutes of inactivity rather than
// needing an explicit release step.
export async function dniRoutes(app: FastifyInstance) {
  app.post<{ Body: DniBody }>('/track/dni', async (req, reply) => {
    const { pixel_key, anonymous_id } = req.body
    if (!pixel_key || !anonymous_id) {
      return reply.code(400).send({ error: 'Missing required fields' })
    }

    const { rows: clientRows } = await db.query('SELECT id FROM clients WHERE pixel_key = $1', [pixel_key])
    if (clientRows.length === 0) {
      return reply.code(401).send({ error: 'Invalid pixel key' })
    }
    const clientId = clientRows[0].id

    // Checks visitor_aliases first (Step 14) so a fingerprint-matched
    // cleared-cookie visitor doesn't 404 here.
    const visitorId = await lookupVisitorId(clientId, anonymous_id)
    if (!visitorId) {
      return reply.code(404).send({ error: 'Visitor not found — call after the pixel has tracked a pageview' })
    }

    // Already has a live assignment — keep it sticky rather than swapping numbers
    // on every page load.
    const { rows: existing } = await db.query(
      `SELECT phone_number FROM tracking_numbers WHERE client_id = $1 AND assigned_visitor_id = $2 AND status = 'assigned'`,
      [clientId, visitorId]
    )
    if (existing.length > 0) {
      return reply.send({ phone_number: existing[0].phone_number })
    }

    const { rows: assigned } = await db.query(
      `UPDATE tracking_numbers
       SET status = 'assigned', assigned_visitor_id = $2, assigned_at = NOW()
       WHERE id = (
         SELECT id FROM tracking_numbers
         WHERE client_id = $1
           AND (status = 'available' OR assigned_at < NOW() - INTERVAL '30 minutes')
         ORDER BY assigned_at ASC NULLS FIRST
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING phone_number`,
      [clientId, visitorId]
    )

    if (assigned.length === 0) {
      // Pool exhausted or no numbers registered yet — degrade gracefully, the
      // pixel just leaves the default phone number on the page.
      return reply.send({ phone_number: null })
    }

    return reply.send({ phone_number: assigned[0].phone_number })
  })
}
