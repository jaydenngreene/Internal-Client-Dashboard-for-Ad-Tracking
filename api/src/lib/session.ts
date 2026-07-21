import { db } from '../db'

interface AdParams {
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
}

// Creates a new ad session when this hit carries ad click data, otherwise attaches to
// the visitor's most recent session (creating a baseline organic/direct session if
// none exists yet). Shared by any endpoint that needs to place a hit into a session —
// pageviews, and any other in-session event (add-to-cart, etc) that doesn't carry
// fresh UTM/click data of its own.
export async function resolveSession(
  clientId: string,
  visitorId: string,
  url: string,
  params: AdParams = {}
): Promise<string> {
  const hasAdData = params.fbclid || params.gclid || params.ttclid || params.utm_source

  if (hasAdData) {
    const { rows } = await db.query(
      `INSERT INTO sessions
       (client_id, visitor_id, fbclid, gclid, ttclid, utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_page, referrer)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        clientId,
        visitorId,
        params.fbclid,
        params.gclid,
        params.ttclid,
        params.utm_source,
        params.utm_medium,
        params.utm_campaign,
        params.utm_content,
        params.utm_term,
        params.landing_page ?? url,
        params.referrer,
      ]
    )
    return rows[0].id
  }

  const { rows: existing } = await db.query(
    `SELECT id FROM sessions WHERE visitor_id = $1 ORDER BY started_at DESC LIMIT 1`,
    [visitorId]
  )
  if (existing.length > 0) return existing[0].id

  const { rows: created } = await db.query(
    `INSERT INTO sessions (client_id, visitor_id, landing_page, referrer) VALUES ($1, $2, $3, $4) RETURNING id`,
    [clientId, visitorId, url, params.referrer]
  )
  return created[0].id
}
