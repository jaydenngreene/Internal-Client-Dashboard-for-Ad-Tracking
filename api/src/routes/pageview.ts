import { FastifyInstance } from 'fastify'
import { db } from '../db'

interface PageviewBody {
  pixel_key: string
  anonymous_id: string
  fbclid?: string
  gclid?: string
  ttclid?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  utm_term?: string
  landing_page?: string
  referrer?: string
  url: string
}

export async function pageviewRoutes(app: FastifyInstance) {
  app.post<{ Body: PageviewBody }>('/track/pageview', async (req, reply) => {
    const {
      pixel_key,
      anonymous_id,
      fbclid,
      gclid,
      ttclid,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term,
      landing_page,
      referrer,
      url,
    } = req.body

    if (!pixel_key || !anonymous_id || !url) {
      return reply.code(400).send({ error: 'Missing required fields' })
    }

    // Resolve client from pixel key
    const { rows: clientRows } = await db.query(
      'SELECT id FROM clients WHERE pixel_key = $1',
      [pixel_key]
    )
    if (clientRows.length === 0) {
      return reply.code(401).send({ error: 'Invalid pixel key' })
    }
    const clientId = clientRows[0].id
    const ip = req.ip
    const userAgent = req.headers['user-agent'] ?? null

    // Upsert visitor
    const { rows: visitorRows } = await db.query(
      `INSERT INTO visitors (client_id, anonymous_id, ip, user_agent)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (client_id, anonymous_id)
       DO UPDATE SET last_seen = NOW(), ip = EXCLUDED.ip
       RETURNING id`,
      [clientId, anonymous_id, ip, userAgent]
    )
    const visitorId = visitorRows[0].id

    // Only create a new session if this pageview carries ad click data OR is the first pageview
    const hasAdData = fbclid || gclid || ttclid || utm_source
    let sessionId: string

    if (hasAdData) {
      // New ad session
      const { rows: sessionRows } = await db.query(
        `INSERT INTO sessions
         (client_id, visitor_id, fbclid, gclid, ttclid, utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_page, referrer)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [clientId, visitorId, fbclid, gclid, ttclid, utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_page ?? url, referrer]
      )
      sessionId = sessionRows[0].id
    } else {
      // Attach to most recent session for this visitor
      const { rows: sessionRows } = await db.query(
        `SELECT id FROM sessions WHERE visitor_id = $1 ORDER BY started_at DESC LIMIT 1`,
        [visitorId]
      )
      if (sessionRows.length === 0) {
        // Organic / direct — create a baseline session
        const { rows: newSession } = await db.query(
          `INSERT INTO sessions (client_id, visitor_id, landing_page, referrer)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [clientId, visitorId, url, referrer]
        )
        sessionId = newSession[0].id
      } else {
        sessionId = sessionRows[0].id
      }
    }

    // Record pageview
    await db.query(
      'INSERT INTO pageviews (client_id, session_id, url) VALUES ($1, $2, $3)',
      [clientId, sessionId, url]
    )

    return reply.code(200).send({ ok: true })
  })
}
