import { db } from '../../db'
import { sendAlert } from '../../lib/alerts'

// Watches the DATA PIPELINE itself, not performance — distinct from
// anomalyDetection/run.ts, which assumes ad_costs/attribution data is trustworthy
// and only checks whether spend/ROAS moved. An agency running many clients' pixels
// unattended has no other way to notice a client's tracking silently broke.
// Three deliberately simple, disclosed heuristics — same "simple, honest method
// over a black-box model" ethos as predictive LTV/creative fatigue — rather than
// a real data-quality-monitoring product.
const SILENT_DAYS = 2 // no sessions at all in this many days is worth a look
const TRAFFIC_DROP_THRESHOLD = 0.6 // yesterday's sessions down 60%+ vs. the 7-day daily average
const MIN_BASELINE_SESSIONS = 20 // don't flag noise from a client with barely any traffic to begin with
const ORPHANED_SPEND_MIN_COST = 10 // don't flag a platform with negligible spend
const ORPHANED_SPEND_WINDOW_DAYS = 3

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

interface ActiveClient {
  id: string
  name: string
}

async function getActiveClients(): Promise<ActiveClient[]> {
  // "Active" here means old enough to judge — a client created yesterday with zero
  // sessions isn't broken, it just hasn't been live long enough to have any yet.
  const { rows } = await db.query<ActiveClient>(
    `SELECT id, name FROM clients WHERE created_at < NOW() - INTERVAL '${SILENT_DAYS} days'`
  )
  return rows
}

async function upsertSignal(
  clientId: string,
  signalType: 'pixel_silent' | 'traffic_drop' | 'platform_orphaned_spend',
  message: string,
  platform: string | null,
  severity: 'warning' | 'critical'
): Promise<boolean> {
  const { rowCount } = await db.query(
    `INSERT INTO tracking_health_signals (client_id, signal_type, platform, severity, message)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (client_id, signal_type, COALESCE(platform, '')) WHERE status = 'active' DO NOTHING`,
    [clientId, signalType, platform, severity, message]
  )
  return (rowCount ?? 0) > 0
}

// A client that has had traffic before but has had literally zero sessions in the
// last SILENT_DAYS days — the "the pixel snippet got removed during a theme
// redesign" scenario, which otherwise goes unnoticed until someone happens to
// check a report.
async function checkPixelSilence(client: ActiveClient): Promise<number> {
  const { rows } = await db.query<{ ever_had_sessions: boolean; recent_sessions: string }>(
    `SELECT
       EXISTS (SELECT 1 FROM sessions WHERE client_id = $1) AS ever_had_sessions,
       (SELECT COUNT(*) FROM sessions WHERE client_id = $1 AND started_at > NOW() - INTERVAL '${SILENT_DAYS} days') AS recent_sessions`,
    [client.id]
  )
  const row = rows[0]
  if (!row?.ever_had_sessions || parseInt(row.recent_sessions, 10) > 0) return 0

  const message = `No pageviews/sessions recorded in the last ${SILENT_DAYS} days, despite earlier activity. The pixel may have been removed or broken (e.g. during a theme change).`
  const created = await upsertSignal(client.id, 'pixel_silent', message, null, 'critical')
  if (created) await sendAlert(client.id, 'Tracking may be broken', `${client.name}: ${message}`)
  return created ? 1 : 0
}

// Total session volume dropped hard vs. its own recent baseline — same
// baseline-vs-yesterday shape as anomalyDetection's account-wide spend/ROAS check,
// applied to raw traffic instead. Catches a partial breakage (e.g. one landing
// page's snippet got removed) that pixel-silence alone wouldn't — some sessions
// still arrive, just far fewer than they should.
async function checkTrafficDrop(client: ActiveClient): Promise<number> {
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const baselineStart = new Date(now)
  baselineStart.setUTCDate(baselineStart.getUTCDate() - 8)
  const baselineEnd = new Date(now)
  baselineEnd.setUTCDate(baselineEnd.getUTCDate() - 2)

  const { rows } = await db.query<{ yesterday_count: string; baseline_count: string }>(
    `SELECT
       (SELECT COUNT(*) FROM sessions WHERE client_id = $1 AND started_at::date = $2) AS yesterday_count,
       (SELECT COUNT(*) FROM sessions WHERE client_id = $1 AND started_at::date BETWEEN $3 AND $4) AS baseline_count`,
    [client.id, isoDate(yesterday), isoDate(baselineStart), isoDate(baselineEnd)]
  )
  const row = rows[0]
  const baselineTotal = parseInt(row?.baseline_count ?? '0', 10)
  const yesterdayCount = parseInt(row?.yesterday_count ?? '0', 10)
  if (baselineTotal < MIN_BASELINE_SESSIONS) return 0

  const baselineDailyAvg = baselineTotal / 7
  const drop = (baselineDailyAvg - yesterdayCount) / baselineDailyAvg
  if (drop < TRAFFIC_DROP_THRESHOLD) return 0

  const message = `Sessions dropped to ${yesterdayCount} yesterday vs. a 7-day average of ${baselineDailyAvg.toFixed(0)}/day (${(drop * 100).toFixed(0)}% down). Worth checking whether tracking is still firing correctly everywhere.`
  const created = await upsertSignal(client.id, 'traffic_drop', message, null, 'warning')
  if (created) await sendAlert(client.id, 'Traffic drop detected', `${client.name}: ${message}`)
  return created ? 1 : 0
}

// A platform is reporting real spend but this app has recorded ~zero matching
// sessions for it in the same window — the exact "CAPI/pixel match-rate drift"
// gap the competitive research flagged: ad spend and on-site tracking have
// silently disconnected for one specific platform, which the account-wide
// pixel-silence/traffic-drop checks above wouldn't catch if every OTHER platform
// is still tracking fine.
async function checkOrphanedSpend(client: ActiveClient): Promise<number> {
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - ORPHANED_SPEND_WINDOW_DAYS)

  const { rows: spendRows } = await db.query<{ platform: string; total_spend: string }>(
    `SELECT platform, SUM(spend) AS total_spend
     FROM ad_costs
     WHERE client_id = $1 AND date >= $2
     GROUP BY platform
     HAVING SUM(spend) >= ${ORPHANED_SPEND_MIN_COST}`,
    [client.id, isoDate(since)]
  )
  if (spendRows.length === 0) return 0

  const { rows: sessionRows } = await db.query<{ utm_source: string | null; count: string }>(
    `SELECT LOWER(TRIM(utm_source)) AS utm_source, COUNT(*) AS count
     FROM sessions
     WHERE client_id = $1 AND started_at >= $2 AND utm_source IS NOT NULL
     GROUP BY LOWER(TRIM(utm_source))`,
    [client.id, since]
  )
  const sessionsBySource = new Map(sessionRows.map((r) => [r.utm_source, parseInt(r.count, 10)]))

  let flagged = 0
  for (const spend of spendRows) {
    // Same normalization the funnel breakdown's source-merge already uses:
    // 'facebook_ads' (ad_costs.platform) vs 'facebook' (sessions.utm_source).
    const normalizedPlatform = spend.platform.replace(/_ads$/, '').toLowerCase()
    const matchedSessions = sessionsBySource.get(normalizedPlatform) ?? 0
    if (matchedSessions > 0) continue

    const message = `$${parseFloat(spend.total_spend).toFixed(2)} spent on ${spend.platform} over the last ${ORPHANED_SPEND_WINDOW_DAYS} days, but zero matching sessions recorded. UTM tagging or the pixel may be broken for this platform specifically.`
    const created = await upsertSignal(client.id, 'platform_orphaned_spend', message, spend.platform, 'critical')
    if (created) {
      await sendAlert(client.id, 'Ad spend with no matching tracking', `${client.name}: ${message}`)
      flagged++
    }
  }
  return flagged
}

// Per-client try/catch so one client's bad data (or a query timing out) never
// blocks the rest — same isolation convention as every other multi-tenant job in
// this app (adCosts/run.ts, anomalyDetection/run.ts).
export async function detectTrackingHealthIssues(): Promise<number> {
  const clients = await getActiveClients()
  let flagged = 0
  for (const client of clients) {
    try {
      flagged += await checkPixelSilence(client)
      flagged += await checkTrafficDrop(client)
      flagged += await checkOrphanedSpend(client)
    } catch (err) {
      console.error(`[trackingHealth] failed for client ${client.id}:`, err instanceof Error ? err.message : err)
    }
  }
  return flagged
}
