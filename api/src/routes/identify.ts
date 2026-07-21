import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { sendConversionSignals } from '../lib/conversionSignals'
import { lookupVisitorId } from '../lib/visitorResolution'

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

    // Get visitor record — checks visitor_aliases first (Step 14) so a
    // fingerprint-matched cleared-cookie visitor doesn't 404 here.
    const visitorId = await lookupVisitorId(clientId, anonymous_id)
    if (!visitorId) {
      return reply.code(404).send({ error: 'Visitor not found' })
    }

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

    const { rows: sessionRows } = await db.query<{ fbclid: string | null; gclid: string | null }>(
      `SELECT fbclid, gclid FROM sessions WHERE visitor_id = $1 ORDER BY started_at DESC LIMIT 1`,
      [visitorId]
    )
    await sendConversionSignals(clientId, {
      eventType: 'Lead',
      email: normalizedEmail,
      fbclid: sessionRows[0]?.fbclid ?? null,
      gclid: sessionRows[0]?.gclid ?? null,
      eventTime: new Date(),
    })

    return reply.code(200).send({ ok: true })
  })
}
