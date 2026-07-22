import { db } from '../db'

// Step 56 — heuristic invalid-traffic detection, not a full fraud-scoring
// service (no IP-reputation/datacenter-range database — genuinely disclosed gap,
// would need a paid IP-intelligence feed this app doesn't have). Two signals:
// known bot/crawler/headless user-agent strings, and excessive session velocity
// from one IP in a short window (a click-farm/bot-farm signature no single
// legitimate visitor produces).
const BOT_USER_AGENT_PATTERN =
  /bot|crawl|spider|slurp|headless|phantomjs|puppeteer|selenium|curl|wget|python-requests|scrapy|facebookexternalhit|Go-http-client/i

const VELOCITY_WINDOW_MINUTES = 60
const VELOCITY_THRESHOLD = 20 // sessions from one IP in the window

export function detectBotUserAgent(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null
  return BOT_USER_AGENT_PATTERN.test(userAgent) ? `bot-like user agent: "${userAgent.slice(0, 80)}"` : null
}

export async function detectClickVelocity(clientId: string, ip: string | null | undefined): Promise<string | null> {
  if (!ip) return null
  const { rows } = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM sessions s
     JOIN visitors v ON v.id = s.visitor_id
     WHERE s.client_id = $1 AND v.ip = $2 AND s.started_at >= NOW() - INTERVAL '${VELOCITY_WINDOW_MINUTES} minutes'`,
    [clientId, ip]
  )
  const count = parseInt(rows[0].count, 10)
  return count >= VELOCITY_THRESHOLD
    ? `${count} sessions from this IP in the last ${VELOCITY_WINDOW_MINUTES} minutes`
    : null
}

export async function detectInvalidTraffic(
  clientId: string,
  userAgent: string | null | undefined,
  ip: string | null | undefined
): Promise<{ isSuspectedBot: boolean; reason: string | null }> {
  const uaReason = detectBotUserAgent(userAgent)
  if (uaReason) return { isSuspectedBot: true, reason: uaReason }

  const velocityReason = await detectClickVelocity(clientId, ip)
  if (velocityReason) return { isSuspectedBot: true, reason: velocityReason }

  return { isSuspectedBot: false, reason: null }
}
