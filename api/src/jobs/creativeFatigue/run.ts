import { db } from '../../db'

// Distinct from Step 35's ad-level ROAS-threshold detection: this watches for a
// SUSTAINED DECLINING TREND in CTR, not a value already crossing a line. Recent
// 3-day average CTR compared against the 7 days immediately before that — a
// simple ratio-based trend check (matching this app's existing "simple, honest,
// disclosed method over a black-box model" ethos, same as predictive LTV's
// cohort-curve approach), not a fitted decay curve.
const RECENT_WINDOW_DAYS = 3
const PRIOR_WINDOW_DAYS = 7
const DECLINE_THRESHOLD = 0.7 // recent CTR must be below 70% of prior CTR
const MIN_PRIOR_IMPRESSIONS = 1000 // don't flag noise from a low-volume creative

interface AdCtrWindow {
  client_id: string
  platform: string
  ad_id: string
  ad_name: string | null
  campaign_name: string | null
  impressions: number
  clicks: number
}

async function getCtrWindow(fromDate: string, toDate: string): Promise<Map<string, AdCtrWindow>> {
  const { rows } = await db.query<{
    client_id: string
    platform: string
    ad_id: string
    ad_name: string | null
    campaign_name: string | null
    impressions: string
    clicks: string
  }>(
    `SELECT client_id, platform, ad_id, MAX(ad_name) AS ad_name, MAX(campaign_name) AS campaign_name,
            SUM(impressions) AS impressions, SUM(clicks) AS clicks
     FROM ad_costs
     WHERE date BETWEEN $1 AND $2
     GROUP BY client_id, platform, ad_id`,
    [fromDate, toDate]
  )
  const map = new Map<string, AdCtrWindow>()
  for (const r of rows) {
    map.set(`${r.client_id}::${r.platform}::${r.ad_id}`, {
      client_id: r.client_id,
      platform: r.platform,
      ad_id: r.ad_id,
      ad_name: r.ad_name,
      campaign_name: r.campaign_name,
      impressions: parseInt(r.impressions, 10),
      clicks: parseInt(r.clicks, 10),
    })
  }
  return map
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function detectCreativeFatigue(): Promise<number> {
  const now = new Date()
  const recentEnd = new Date(now)
  recentEnd.setUTCDate(recentEnd.getUTCDate() - 1) // yesterday, same "today's still live" reasoning as ad-cost sync
  const recentStart = new Date(recentEnd)
  recentStart.setUTCDate(recentStart.getUTCDate() - (RECENT_WINDOW_DAYS - 1))

  const priorEnd = new Date(recentStart)
  priorEnd.setUTCDate(priorEnd.getUTCDate() - 1)
  const priorStart = new Date(priorEnd)
  priorStart.setUTCDate(priorStart.getUTCDate() - (PRIOR_WINDOW_DAYS - 1))

  const [recentWindows, priorWindows] = await Promise.all([
    getCtrWindow(isoDate(recentStart), isoDate(recentEnd)),
    getCtrWindow(isoDate(priorStart), isoDate(priorEnd)),
  ])

  let flagged = 0
  for (const [key, recent] of recentWindows) {
    const prior = priorWindows.get(key)
    if (!prior || prior.impressions < MIN_PRIOR_IMPRESSIONS || recent.impressions === 0) continue

    const recentCtr = (recent.clicks / recent.impressions) * 100
    const priorCtr = (prior.clicks / prior.impressions) * 100
    if (priorCtr <= 0) continue
    if (recentCtr >= priorCtr * DECLINE_THRESHOLD) continue

    const declinePct = ((priorCtr - recentCtr) / priorCtr) * 100

    const { rowCount } = await db.query(
      `INSERT INTO creative_fatigue_signals (client_id, platform, ad_id, ad_name, campaign_name, recent_ctr, prior_ctr, decline_pct)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (client_id, platform, ad_id) WHERE status = 'active' DO NOTHING`,
      [recent.client_id, recent.platform, recent.ad_id, recent.ad_name, recent.campaign_name, recentCtr, priorCtr, declinePct]
    )
    if (rowCount && rowCount > 0) flagged++
  }
  return flagged
}
