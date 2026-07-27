import { db } from '../../db'
import { checkGate } from '../../lib/recommendationGate'
import { GUARDRAIL_CONFIG } from '../../config/recommendationGuardrails'

// Phase 1 rebuild (2026-07-27) of Step 47's original CTR-only fatigue detector.
// Two upgrades over the original: (1) a day-scale trend (recent 3d vs prior 7d,
// same as before) must ALSO be echoed at a week-scale (recent 7d vs prior 14d)
// before this calls it "fatigue" — a dip that only shows up on the short window
// is noise, not a trend; (2) every flagged ad must first clear the Phase 1 data-
// sufficiency gate (recommendationGate.ts) — a creative too new/under-spent to
// have earned a verdict never gets flagged, no matter how it's trending.
const RECENT_SHORT_DAYS = 3
const PRIOR_SHORT_DAYS = 7
const RECENT_LONG_DAYS = 7
const PRIOR_LONG_DAYS = 14

const DECLINE_THRESHOLD = 0.7 // ROAS/CTR must fall below 70% of baseline to count as decline
const INCREASE_THRESHOLD = 1.3 // CPA/CPM/frequency must rise above 130% of baseline to count as decline
const MIN_PRIOR_IMPRESSIONS = 1000 // don't call a trend on a low-volume window either side

interface AdWindow {
  client_id: string
  platform: string
  ad_id: string
  ad_name: string | null
  campaign_name: string | null
  impressions: number
  clicks: number
  spend: number
  revenue: number
  sales: number
  avgFrequency: number | null
}

function windowKey(clientId: string, platform: string, adId: string): string {
  return `${clientId}::${platform}::${adId}`
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// One combined query per window: ad_costs for spend/impressions/clicks/frequency,
// left-joined to attributed revenue/sales via the same utm_content-matches-
// ad_name-or-ad_id convention every other report/job in this app already uses
// (reports.ts, anomalyDetection.ts) — kept as a self-contained query here rather
// than importing those routes' internals, same isolation reasoning this file
// already stated for its original CTR-only version.
async function getAdWindow(fromDate: string, toDate: string): Promise<Map<string, AdWindow>> {
  const { rows } = await db.query<{
    client_id: string
    platform: string
    ad_id: string
    ad_name: string | null
    campaign_name: string | null
    impressions: string
    clicks: string
    spend: string
    avg_frequency: string | null
    revenue: string
    sales: string
  }>(
    `SELECT
       ac.client_id, ac.platform, ac.ad_id, MAX(ac.ad_name) AS ad_name, MAX(ac.campaign_name) AS campaign_name,
       SUM(ac.impressions) AS impressions, SUM(ac.clicks) AS clicks, SUM(ac.spend) AS spend,
       AVG(ac.frequency) FILTER (WHERE ac.frequency IS NOT NULL) AS avg_frequency,
       COALESCE(rev.total, 0) AS revenue, COALESCE(rev.sales, 0) AS sales
     FROM ad_costs ac
     LEFT JOIN (
       SELECT a.client_id, s.utm_content, SUM(a.attributed_revenue) AS total, COUNT(DISTINCT a.purchase_id) AS sales
       FROM attributions a
       JOIN sessions s ON s.id = a.session_id
       JOIN purchases p ON p.id = a.purchase_id
       WHERE p.purchased_at::date BETWEEN $1 AND $2
       GROUP BY a.client_id, s.utm_content
     ) rev ON rev.client_id = ac.client_id
       AND (LOWER(TRIM(rev.utm_content)) = LOWER(TRIM(ac.ad_name)) OR rev.utm_content = ac.ad_id)
     WHERE ac.date BETWEEN $1 AND $2
     GROUP BY ac.client_id, ac.platform, ac.ad_id, rev.total, rev.sales`,
    [fromDate, toDate]
  )
  const map = new Map<string, AdWindow>()
  for (const r of rows) {
    map.set(windowKey(r.client_id, r.platform, r.ad_id), {
      client_id: r.client_id,
      platform: r.platform,
      ad_id: r.ad_id,
      ad_name: r.ad_name,
      campaign_name: r.campaign_name,
      impressions: parseInt(r.impressions, 10),
      clicks: parseInt(r.clicks, 10),
      spend: parseFloat(r.spend),
      avgFrequency: r.avg_frequency !== null ? parseFloat(r.avg_frequency) : null,
      revenue: parseFloat(r.revenue),
      sales: parseInt(r.sales, 10),
    })
  }
  return map
}

interface MetricTrend {
  metric: 'roas' | 'ctr' | 'cpa' | 'cpm' | 'frequency'
  direction: 'decline' | 'increase' // which direction counts as "worse" for this metric
  recentShort: number | null
  priorShort: number | null
  recentLong: number | null
  priorLong: number | null
}

function isBadMove(recent: number | null, prior: number | null, direction: 'decline' | 'increase', threshold: number): boolean {
  if (recent === null || prior === null || prior <= 0) return false
  return direction === 'decline' ? recent < prior * threshold : recent > prior * threshold
}

// A metric only counts as a sustained trend (not a one-day blip) if it shows the
// same bad-direction move on BOTH the day-scale (short) and week-scale (long)
// comparison — the spec's explicit "trend direction over days AND weeks, not a
// single-day dip."
function isSustainedTrend(m: MetricTrend): boolean {
  const threshold = m.direction === 'decline' ? DECLINE_THRESHOLD : INCREASE_THRESHOLD
  return isBadMove(m.recentShort, m.priorShort, m.direction, threshold) && isBadMove(m.recentLong, m.priorLong, m.direction, threshold)
}

function deriveMetrics(w: AdWindow): { ctr: number | null; roas: number | null; cpa: number | null; cpm: number | null } {
  return {
    ctr: w.impressions > 0 ? (w.clicks / w.impressions) * 100 : null,
    roas: w.spend > 0 ? w.revenue / w.spend : null,
    cpa: w.sales > 0 ? w.spend / w.sales : null,
    cpm: w.impressions > 0 ? (w.spend / w.impressions) * 1000 : null,
  }
}

export async function detectCreativeFatigue(): Promise<number> {
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1) // same "today's still live" reasoning as ad-cost sync

  const recentShortEnd = yesterday
  const recentShortStart = new Date(recentShortEnd)
  recentShortStart.setUTCDate(recentShortStart.getUTCDate() - (RECENT_SHORT_DAYS - 1))

  const priorShortEnd = new Date(recentShortStart)
  priorShortEnd.setUTCDate(priorShortEnd.getUTCDate() - 1)
  const priorShortStart = new Date(priorShortEnd)
  priorShortStart.setUTCDate(priorShortStart.getUTCDate() - (PRIOR_SHORT_DAYS - 1))

  const recentLongEnd = yesterday
  const recentLongStart = new Date(recentLongEnd)
  recentLongStart.setUTCDate(recentLongStart.getUTCDate() - (RECENT_LONG_DAYS - 1))

  const priorLongEnd = new Date(recentLongStart)
  priorLongEnd.setUTCDate(priorLongEnd.getUTCDate() - 1)
  const priorLongStart = new Date(priorLongEnd)
  priorLongStart.setUTCDate(priorLongStart.getUTCDate() - (PRIOR_LONG_DAYS - 1))

  const [recentShort, priorShort, recentLong, priorLong] = await Promise.all([
    getAdWindow(isoDate(recentShortStart), isoDate(recentShortEnd)),
    getAdWindow(isoDate(priorShortStart), isoDate(priorShortEnd)),
    getAdWindow(isoDate(recentLongStart), isoDate(recentLongEnd)),
    getAdWindow(isoDate(priorLongStart), isoDate(priorLongEnd)),
  ])

  // Bulk, system-wide (not per-ad) lookups so this stays one query each instead
  // of an N+1 across however many ads showed spend yesterday.
  const { rows: firstSeenRows } = await db.query<{ client_id: string; platform: string; ad_id: string; first_date: string }>(
    `SELECT client_id, platform, ad_id, MIN(date) AS first_date FROM ad_costs GROUP BY client_id, platform, ad_id`
  )
  const firstSeenMap = new Map(firstSeenRows.map((r) => [windowKey(r.client_id, r.platform, r.ad_id), r.first_date]))

  const lookbackEnd = isoDate(yesterday)
  const lookbackStartDate = new Date(yesterday)
  lookbackStartDate.setUTCDate(lookbackStartDate.getUTCDate() - (GUARDRAIL_CONFIG.lookbackDays - 1))
  const lookback = await getAdWindow(isoDate(lookbackStartDate), lookbackEnd)

  let flagged = 0
  for (const [key, rs] of recentShort) {
    const ps = priorShort.get(key)
    const rl = recentLong.get(key)
    const pl = priorLong.get(key)
    // No prior window at all, or too little volume in it to trust a comparison —
    // matches the spec's explicit "if there's no earlier window to decay from,
    // don't call fatigue, return insufficient history instead" (we simply don't
    // flag; there's no confirm-first review queue entry expecting a row here the
    // way pause_candidates does, so "insufficient history" here means "skipped").
    if (!ps || ps.impressions < MIN_PRIOR_IMPRESSIONS) continue
    if (!rl || !pl || pl.impressions < MIN_PRIOR_IMPRESSIONS) continue

    const dRS = deriveMetrics(rs)
    const dPS = deriveMetrics(ps)
    const dRL = deriveMetrics(rl)
    const dPL = deriveMetrics(pl)

    const trends: MetricTrend[] = [
      { metric: 'roas', direction: 'decline', recentShort: dRS.roas, priorShort: dPS.roas, recentLong: dRL.roas, priorLong: dPL.roas },
      { metric: 'ctr', direction: 'decline', recentShort: dRS.ctr, priorShort: dPS.ctr, recentLong: dRL.ctr, priorLong: dPL.ctr },
      { metric: 'cpa', direction: 'increase', recentShort: dRS.cpa, priorShort: dPS.cpa, recentLong: dRL.cpa, priorLong: dPL.cpa },
      { metric: 'cpm', direction: 'increase', recentShort: dRS.cpm, priorShort: dPS.cpm, recentLong: dRL.cpm, priorLong: dPL.cpm },
      {
        metric: 'frequency',
        direction: 'increase',
        recentShort: rs.avgFrequency,
        priorShort: ps.avgFrequency,
        recentLong: rl.avgFrequency,
        priorLong: pl.avgFrequency,
      },
    ]
    const triggered = trends.filter(isSustainedTrend)
    if (triggered.length === 0) continue

    const firstSeen = firstSeenMap.get(key)
    const daysLive = firstSeen ? Math.max(Math.floor((now.getTime() - new Date(firstSeen).getTime()) / 86400000), 0) : 0
    const lookbackWindow = lookback.get(key)
    const gate = await checkGate(rs.client_id, 'creative', daysLive, lookbackWindow?.spend ?? 0, lookbackWindow?.sales ?? 0)
    // The whole point of the gate: a creative that's declining but hasn't earned
    // a verdict yet (too new, too little spend) never gets flagged — no matter
    // how sharp the trend looks on paper.
    if (!gate.passed) continue

    const metricsTriggered = Object.fromEntries(
      trends.map((t) => [
        t.metric,
        {
          recentShort: t.recentShort,
          priorShort: t.priorShort,
          recentLong: t.recentLong,
          priorLong: t.priorLong,
          triggered: triggered.includes(t),
        },
      ])
    )

    const { rowCount } = await db.query(
      `INSERT INTO creative_fatigue_signals
         (client_id, platform, ad_id, ad_name, campaign_name, recent_ctr, prior_ctr, decline_pct,
          days_live, confidence, gate_opened_by, cost_per_purchase_basis, spend_threshold, spend, metrics_triggered)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (client_id, platform, ad_id) WHERE status = 'active' DO NOTHING`,
      [
        rs.client_id,
        rs.platform,
        rs.ad_id,
        rs.ad_name,
        rs.campaign_name,
        dRS.ctr ?? 0,
        dPS.ctr ?? 0,
        dPS.ctr ? ((dPS.ctr - (dRS.ctr ?? 0)) / dPS.ctr) * 100 : 0,
        daysLive,
        gate.confidence,
        gate.openedBy,
        gate.costPerPurchase,
        gate.spendThreshold,
        lookbackWindow?.spend ?? 0,
        JSON.stringify(metricsTriggered),
      ]
    )
    if (rowCount && rowCount > 0) flagged++
  }
  return flagged
}
