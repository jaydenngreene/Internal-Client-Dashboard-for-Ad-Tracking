import { FastifyInstance } from 'fastify'
import { db } from '../db'

interface IdentifyBody {
  pixel_key: string
  anonymous_id: string
  email: string
  lead_type?: string
  page?: string
  metadata?: Record<string, unknown>
}

export async function identifyRoutes(app: FastifyInstance) {
  app.post<{ Body: IdentifyBody }>('/track/identify', async (req, reply) => {
    const { pixel_key, anonymous_id, email, lead_type = 'optin', page, metadata } = req.body

    if (!pixel_key || !anonymous_id || !email) {
      return reply.code(400).send({ error: 'Missing required fields' })
    }

    const normalizedEmail = email.toLowerCase().trim()

    const { rows: clientRows } = await db.query(
      'SELECT id FROM clients WHERE pixel_key = $1',
      [pixel_key]
    )
    if (clientRows.length === 0) {
      return reply.code(401).send({ error: 'Invalid pixel key' })
    }
    const clientId = clientRows[0].id

    // Get visitor record
    const { rows: visitorRows } = await db.query(
      'SELECT id FROM visitors WHERE client_id = $1 AND anonymous_id = $2',
      [clientId, anonymous_id]
    )
    if (visitorRows.length === 0) {
      return reply.code(404).send({ error: 'Visitor not found' })
    }
    const visitorId = visitorRows[0].id

    // Link email to visitor (upsert — if email seen before, update visitor link)
    await db.query(
      `INSERT INTO identities (client_id, email, visitor_id, identified_on_page)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (client_id, email)
       DO UPDATE SET visitor_id = EXCLUDED.visitor_id, identified_at = NOW(), identified_on_page = EXCLUDED.identified_on_page`,
      [clientId, normalizedEmail, visitorId, page]
    )

    // Record the lead event
    await db.query(
      `INSERT INTO leads (client_id, email, lead_type, page, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [clientId, normalizedEmail, lead_type, page, metadata ? JSON.stringify(metadata) : null]
    )

    return reply.code(200).send({ ok: true })
  })
}
