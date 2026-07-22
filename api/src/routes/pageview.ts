import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { resolveSession } from '../lib/session'
import { resolveVisitor } from '../lib/visitorResolution'

interface PageviewBody {
  pixel_key: string
  anonymous_id: string
  fbclid?: string
  gclid?: string
  ttclid?: string
  msclkid?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  utm_term?: string
  landing_page?: string
  referrer?: string
  url: string
  fingerprint_hash?: string
  fingerprint_components?: Record<string, unknown>
}

export async function pageviewRoutes(app: FastifyInstance) {
  app.post<{ Body: PageviewBody }>('/track/pageview', async (req, reply) => {
    const {
      pixel_key,
      anonymous_id,
      fbclid,
      gclid,
      ttclid,
      msclkid,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term,
      landing_page,
      referrer,
      url,
      fingerprint_hash,
      fingerprint_components,
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

    // Step 14 — resolves via visitor_aliases/fingerprint match before falling back
    // to creating a new visitor, so a cleared cookie doesn't fragment one person's
    // history across two visitor rows (see lib/visitorResolution.ts).
    const visitorId = await resolveVisitor({
      clientId,
      anonymousId: anonymous_id,
      ip,
      userAgent,
      fingerprintHash: fingerprint_hash,
      fingerprintComponents: fingerprint_components,
    })

    const sessionId = await resolveSession(
      clientId,
      visitorId,
      url,
      {
        fbclid,
        gclid,
        ttclid,
        msclkid,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_content,
        utm_term,
        landing_page,
        referrer,
      },
      ip,
      userAgent
    )

    // Record pageview
    await db.query(
      'INSERT INTO pageviews (client_id, session_id, url) VALUES ($1, $2, $3)',
      [clientId, sessionId, url]
    )

    return reply.code(200).send({ ok: true })
  })
}
