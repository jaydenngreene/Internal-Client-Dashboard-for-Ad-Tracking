import { db } from '../db'
import { lookupGeo } from './geo'
import { detectInvalidTraffic } from './botDetection'

export interface AdParams {
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
}

// Shopify tracks each order's `landing_site` (the first page the customer ever
// visited this store on, e.g. "/products/foo?fbclid=...&utm_source=facebook")
// itself, via its own first-party cookie - independent of our pixel entirely.
// Useful as an attribution fallback when our own session tracking comes up
// empty (2026-07-25: found live that Shopify's checkout Web Pixel sandbox
// doesn't reliably return the same visitor cookie the storefront pixel set,
// so identity linking silently fails for real orders even with everything
// installed correctly). `landing_site` is a relative path+query, not an
// absolute URL - reject anything with no query string before it even gets here.
export function parseAdParamsFromLandingSite(landingSite: string | null | undefined): AdParams | null {
  if (!landingSite) return null
  const queryIndex = landingSite.indexOf('?')
  if (queryIndex === -1) return null

  const params = new URLSearchParams(landingSite.slice(queryIndex + 1))
  const adParams: AdParams = {
    fbclid: params.get('fbclid') ?? undefined,
    gclid: params.get('gclid') ?? undefined,
    ttclid: params.get('ttclid') ?? undefined,
    msclkid: params.get('msclkid') ?? undefined,
    utm_source: params.get('utm_source') ?? undefined,
    utm_medium: params.get('utm_medium') ?? undefined,
    utm_campaign: params.get('utm_campaign') ?? undefined,
    utm_content: params.get('utm_content') ?? undefined,
    utm_term: params.get('utm_term') ?? undefined,
    landing_page: landingSite,
  }
  const hasAdData = adParams.fbclid || adParams.gclid || adParams.ttclid || adParams.msclkid || adParams.utm_source
  return hasAdData ? adParams : null
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
  params: AdParams = {},
  ip?: string | null,
  userAgent?: string | null
): Promise<string> {
  const hasAdData = params.fbclid || params.gclid || params.ttclid || params.msclkid || params.utm_source
  const geo = lookupGeo(ip)

  if (hasAdData) {
    // Step 56 — computed once, at the moment a NEW ad session is created (not on
    // every attached-event lookup below) — this is the one point where invalid
    // traffic would otherwise silently enter attribution/funnel metrics.
    const { isSuspectedBot, reason } = await detectInvalidTraffic(clientId, userAgent, ip)
    const { rows } = await db.query(
      `INSERT INTO sessions
       (client_id, visitor_id, fbclid, gclid, ttclid, msclkid, utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_page, referrer, country, region, is_suspected_bot, bot_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING id`,
      [
        clientId,
        visitorId,
        params.fbclid,
        params.gclid,
        params.ttclid,
        params.msclkid,
        params.utm_source,
        params.utm_medium,
        params.utm_campaign,
        params.utm_content,
        params.utm_term,
        params.landing_page ?? url,
        params.referrer,
        geo.country,
        geo.region,
        isSuspectedBot,
        reason,
      ]
    )
    return rows[0].id
  }

  const { rows: existing } = await db.query(
    `SELECT id FROM sessions WHERE visitor_id = $1 ORDER BY started_at DESC LIMIT 1`,
    [visitorId]
  )
  if (existing.length > 0) return existing[0].id

  const { isSuspectedBot, reason } = await detectInvalidTraffic(clientId, userAgent, ip)
  const { rows: created } = await db.query(
    `INSERT INTO sessions (client_id, visitor_id, landing_page, referrer, country, region, is_suspected_bot, bot_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [clientId, visitorId, url, params.referrer, geo.country, geo.region, isSuspectedBot, reason]
  )
  return created[0].id
}
