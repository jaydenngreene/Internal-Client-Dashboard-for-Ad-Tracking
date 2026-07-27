import { db } from '../../db'
import { getCostContext, evaluateGate, CostContext } from '../../lib/recommendationGate'
import { GUARDRAIL_CONFIG } from '../../config/recommendationGuardrails'

// Phase 1 rebuild (2026-07-27) of Step 47's original CTR-only fatigue detector,
// then hardened in review (2026-07-28 — see docs/ISSUE_LOG.md): a day-scale
// trend (recent 3d vs prior 7d) must ALSO be echoed at a week-scale (recent 7d
// vs prior 14d) before this calls it "fatigue" — a dip that only shows up on
// the short window is noise, not a trend. Every flagged ad must first clear
// the Phase 1 data-sufficiency gate (recommendationGate.ts).
const RECENT_SHORT_DAYS = 3
const PRIOR_SHORT_DAYS = 7
const RECENT_LONG_DAYS = 7
const PRIOR_LONG_DAYS = 14

const DECLINE_THRESHOLD = 0.7 // ROAS/CTR must fall below 70% of baseline to count as decline
const INCREASE_THRESHOLD = 1.3 // CPA/CPM/frequency must rise above 130% of baseline to count as decline
const MIN_WINDOW_IMPRESSIONS = 1000 // don't call a trend on a low-volume window, recent OR prior
// ROAS/CPA swing wildly on a window with plenty of impressions but 0-1 sales —
// impressions don't stabilize a conversion-driven metric, sales count does.
// Below this, that window's ROAS/CPA value is treated as unknown (null), not
// as a real 0-vs-1-sale swing worth calling a trend.
const MIN_SALES_FOR_CONVERSION_METRICS = 3

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

type MetricName = 'roas' | 'ctr' | 'cpa' | 'cpm' | 'frequency'

interface MetricTrend {
  metric: MetricName
  direction: 'decline' | 'increase' // which direction counts as "worse" for this metric
  recentShort: number | null
  priorShort: number | null
  recentLong: number | null
  priorLong: number | null
}

// Only these three can raise a fatigue flag on their own. CPM is driven by
// auction competition/seasonality (a Q4 cost spike would flag every ad in the
// account with no creative having changed) and rising frequency is the
// expected behavior of any ad left running (a fatigue *precursor*, not
// fatigue itself) — both are demoted to corroborating signals below: they can
// still show up in metrics_triggered and strengthen the picture, but never
// raise a flag alone.
const PRIMARY_TRIGGER_METRICS: MetricName[] = ['roas', 'cpa', 'ctr']

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

// "How much worse" as a positive percentage regardless of the metric's own
// direction convention (a decline-type metric like ROAS moving down, or an
// increase-type metric like CPA moving up) — only called on a metric that
// already passed isSustainedTrend, so recentShort/priorShort are guaranteed
// non-null and priorShort > 0.
function worsePercent(m: MetricTrend): number {
  const recent = m.recentShort as number
  const prior = m.priorShort as number
  return m.direction === 'decline' ? ((prior - recent) / prior) * 100 : ((recent - prior) / prior) * 100
}

// Review fix (2026-07-28, item 8, corrected): picks ONE metric whose actual
// values get written into the legacy recent_ctr/prior_ctr/decline_pct columns
// (see primary_metric alongside them) — previously those columns were always
// CTR regardless of what triggered the flag, so an ad flagged solely on ROAS
// wrote a decline_pct that could read as zero or negative: a false claim
// about why it was flagged, not just a UI display bug. Priority order matches
// PRIMARY_TRIGGER_METRICS (ROAS > CPA > CTR) rather than trends' array order,
// since ROAS is the most business-relevant of the three when more than one
// triggers at once.
function choosePrimaryMetric(triggeredPrimary: MetricTrend[]): MetricTrend {
  for (const name of PRIMARY_TRIGGER_METRICS) {
    const match = triggeredPrimary.find((t) => t.metric === name)
    if (match) return match
  }
  throw new Error('choosePrimaryMetric called with no triggered primary metric') // triggeredPrimary.length === 0 is checked by the caller before this can run
}

function meetsConversionFloor(w: AdWindow): boolean {
  return w.sales >= MIN_SALES_FOR_CONVERSION_METRICS
}

function deriveMetrics(w: AdWindow): { ctr: number | null; roas: number | null; cpa: number | null; cpm: number | null } {
  const conversionMetricsValid = meetsConversionFloor(w)
  return {
    ctr: w.impressions > 0 ? (w.clicks / w.impressions) * 100 : null,
    roas: w.spend > 0 && conversionMetricsValid ? w.revenue / w.spend : null,
    cpa: conversionMetricsValid ? w.spend / w.sales : null,
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

  // Bulk, system-wide (not per-ad) lookup so this stays one query instead of
  // an N+1 across however many ads showed spend yesterday. Review fix
  // (2026-07-28, item 5): COUNT(DISTINCT date) WHERE spend > 0, not MIN(date)
  // subtracted from today — the old calendar-elapsed version let a creative
  // that ran 5 days in March, paused, and resumed yesterday read as ~4 months
  // live, sailing through the days-live side of the gate on 6 days of real
  // data.
  const { rows: daysLiveRows } = await db.query<{ client_id: string; platform: string; ad_id: string; days_live: string }>(
    `SELECT client_id, platform, ad_id, COUNT(DISTINCT date) FILTER (WHERE spend > 0) AS days_live
     FROM ad_costs GROUP BY client_id, platform, ad_id`
  )
  const daysLiveMap = new Map(daysLiveRows.map((r) => [windowKey(r.client_id, r.platform, r.ad_id), parseInt(r.days_live, 10)]))

  const lookbackEnd = isoDate(yesterday)
  const lookbackStartDate = new Date(yesterday)
  lookbackStartDate.setUTCDate(lookbackStartDate.getUTCDate() - (GUARDRAIL_CONFIG.lookbackDays - 1))
  const lookback = await getAdWindow(isoDate(lookbackStartDate), lookbackEnd)

  // Review fix (2026-07-28, item 6): fetch each distinct client's cost context
  // ONCE before the loop, not once per ad inside it — evaluateGate (pure, no
  // DB access) was split out from checkGate specifically so a caller looping
  // over many entities could do this, and this loop wasn't actually doing it.
  const distinctClientIds = new Set([...recentShort.values()].map((w) => w.client_id))
  const costCtxByClient = new Map<string, CostContext>()
  await Promise.all(
    [...distinctClientIds].map(async (id) => costCtxByClient.set(id, await getCostContext(id)))
  )

  let flagged = 0
  for (const [key, rs] of recentShort) {
    const ps = priorShort.get(key)
    const rl = recentLong.get(key)
    const pl = priorLong.get(key)
    // No prior window at all, or too little volume on EITHER side of either
    // comparison to trust it — review fix (item 4): the recent windows
    // (rs/rl) previously had no floor at all, only the prior windows did.
    if (!ps || rs.impressions < MIN_WINDOW_IMPRESSIONS || ps.impressions < MIN_WINDOW_IMPRESSIONS) continue
    if (!rl || !pl || rl.impressions < MIN_WINDOW_IMPRESSIONS || pl.impressions < MIN_WINDOW_IMPRESSIONS) continue

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
    // Review fix (item 3): only roas/cpa/ctr can raise a flag by themselves.
    // cpm/frequency are computed and reported the same as any other metric
    // (see metricsTriggered below) but never gate the decision on their own.
    const triggeredPrimary = trends.filter((t) => PRIMARY_TRIGGER_METRICS.includes(t.metric) && isSustainedTrend(t))
    if (triggeredPrimary.length === 0) continue
    const allTriggered = trends.filter(isSustainedTrend)
    const primaryMetric = choosePrimaryMetric(triggeredPrimary)

    const firstSeen = daysLiveMap.get(key) ?? 0
    const daysLive = firstSeen
    const lookbackWindow = lookback.get(key)
    const costCtx = costCtxByClient.get(rs.client_id)
    if (!costCtx) continue // shouldn't happen — every ad's client_id came from recentShort, which seeded distinctClientIds
    const gate = evaluateGate(costCtx, 'creative', daysLive, lookbackWindow?.spend ?? 0, lookbackWindow?.sales ?? 0)
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
          triggered: allTriggered.includes(t),
        },
      ])
    )

    const { rowCount } = await db.query(
      `INSERT INTO creative_fatigue_signals
         (client_id, platform, ad_id, ad_name, campaign_name, recent_ctr, prior_ctr, decline_pct, primary_metric,
          days_live, confidence, gate_opened_by, cost_per_purchase_basis, spend_threshold, spend, metrics_triggered)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (client_id, platform, ad_id) WHERE status = 'active' DO NOTHING`,
      [
        rs.client_id,
        rs.platform,
        rs.ad_id,
        rs.ad_name,
        rs.campaign_name,
        // recent_ctr/prior_ctr/decline_pct are legacy column names (predate
        // the multi-metric rebuild) but now hold whichever metric actually
        // triggered the flag, not always CTR — primary_metric says which.
        primaryMetric.recentShort,
        primaryMetric.priorShort,
        worsePercent(primaryMetric),
        primaryMetric.metric,
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
