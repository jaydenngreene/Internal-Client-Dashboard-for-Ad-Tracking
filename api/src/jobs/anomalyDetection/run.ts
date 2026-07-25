import { db } from '../../db'
import { sendAlert } from '../../lib/alerts'

// Yesterday's account-wide cost/revenue/sales vs. the trailing-7-day baseline
// immediately before it (2-8 days ago, i.e. excluding yesterday itself so a
// worsening trend doesn't get averaged into its own baseline). Deliberately
// account-wide, not per-campaign — a per-campaign version would need per-campaign
// thresholds tuned to that campaign's own volatility, a bigger feature than "did
// something break overnight."
const SPEND_CHANGE_THRESHOLD = 0.5 // +/-50% vs baseline
const ROAS_DROP_THRESHOLD = 0.5 // ROAS falls below 50% of baseline ROAS

interface ClientDayMetrics {
  client_id: string
  cost: number
  revenue: number
}

async function getDayMetrics(fromDate: string, toDate: string): Promise<Map<string, ClientDayMetrics>> {
  const { rows } = await db.query<{ client_id: string; cost: string; revenue: string }>(
    `SELECT
       c.id AS client_id,
       COALESCE(spend.total, 0) AS cost,
       COALESCE(rev.total, 0) AS revenue
     FROM clients c
     LEFT JOIN (
       SELECT client_id, SUM(spend) AS total FROM ad_costs
       WHERE date BETWEEN $1 AND $2 GROUP BY client_id
     ) spend ON spend.client_id = c.id
     LEFT JOIN (
       SELECT a.client_id, SUM(a.attributed_revenue) AS total
       FROM attributions a JOIN purchases p ON p.id = a.purchase_id
       WHERE p.purchased_at::date BETWEEN $1 AND $2
       GROUP BY a.client_id
     ) rev ON rev.client_id = c.id`,
    [fromDate, toDate]
  )
  const map = new Map<string, ClientDayMetrics>()
  for (const r of rows) {
    map.set(r.client_id, { client_id: r.client_id, cost: parseFloat(r.cost), revenue: parseFloat(r.revenue) })
  }
  return map
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

interface AdDayMetrics {
  client_id: string
  platform: string
  ad_id: string
  ad_name: string | null
  campaign_name: string | null
  cost: number
  revenue: number
}

// Same baseline-vs-yesterday shape as the account-wide check, but grouped down to
// one ad — revenue is joined by utm_content matching ad_name, the same convention
// the funnel breakdown's creative mode already uses (Step 27/post-Step-30 review).
async function getAdDayMetrics(fromDate: string, toDate: string): Promise<Map<string, AdDayMetrics>> {
  const { rows } = await db.query<{
    client_id: string
    platform: string
    ad_id: string
    ad_name: string | null
    campaign_name: string | null
    cost: string
    revenue: string
  }>(
    `SELECT
       ac.client_id, ac.platform, ac.ad_id, ac.ad_name, ac.campaign_name,
       SUM(ac.spend) AS cost,
       COALESCE(rev.total, 0) AS revenue
     FROM ad_costs ac
     LEFT JOIN (
       SELECT a.client_id, s.utm_content, SUM(a.attributed_revenue) AS total
       FROM attributions a
       JOIN sessions s ON s.id = a.session_id
       JOIN purchases p ON p.id = a.purchase_id
       WHERE p.purchased_at::date BETWEEN $1 AND $2
       GROUP BY a.client_id, s.utm_content
     -- A client's ad URLs can carry Meta's raw {{ad.id}} in utm_content instead
     -- of the ad name (confirmed live) - match on either.
     ) rev ON rev.client_id = ac.client_id
       AND (LOWER(TRIM(rev.utm_content)) = LOWER(TRIM(ac.ad_name)) OR rev.utm_content = ac.ad_id)
     WHERE ac.date BETWEEN $1 AND $2
     GROUP BY ac.client_id, ac.platform, ac.ad_id, ac.ad_name, ac.campaign_name, rev.total`,
    [fromDate, toDate]
  )
  const map = new Map<string, AdDayMetrics>()
  for (const r of rows) {
    map.set(`${r.client_id}::${r.platform}::${r.ad_id}`, {
      client_id: r.client_id,
      platform: r.platform,
      ad_id: r.ad_id,
      ad_name: r.ad_name,
      campaign_name: r.campaign_name,
      cost: parseFloat(r.cost),
      revenue: parseFloat(r.revenue),
    })
  }
  return map
}

// Ad-level version of the account-wide ROAS check — flags one specific
// underperforming ad as a pause_candidates row (Step 35, confirm-first by explicit
// user decision, never pauses anything itself) instead of just an account-wide
// alert with no actionable next step. Skipped if a pending candidate already
// exists for that ad (the partial unique index enforces this at the DB level too;
// checked here first so a duplicate insert doesn't need to fail loudly every day).
async function detectAdLevelAnomalies(): Promise<number> {
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const baselineStart = new Date(now)
  baselineStart.setUTCDate(baselineStart.getUTCDate() - 8)
  const baselineEnd = new Date(now)
  baselineEnd.setUTCDate(baselineEnd.getUTCDate() - 2)

  const [yesterdayAds, baselineAds] = await Promise.all([
    getAdDayMetrics(isoDate(yesterday), isoDate(yesterday)),
    getAdDayMetrics(isoDate(baselineStart), isoDate(baselineEnd)),
  ])

  let flagged = 0
  for (const [key, today] of yesterdayAds) {
    const baseline = baselineAds.get(key)
    if (!baseline || baseline.cost <= 0) continue

    const baselineDailyCost = baseline.cost / 7
    const baselineDailyRevenue = baseline.revenue / 7
    const baselineRoas = baselineDailyCost > 0 ? baselineDailyRevenue / baselineDailyCost : null
    const todayRoas = today.cost > 0 ? today.revenue / today.cost : null
    if (baselineRoas === null || baselineRoas <= 0) continue
    if (todayRoas !== null && todayRoas >= baselineRoas * ROAS_DROP_THRESHOLD) continue
    // Only worth flagging once there's meaningful spend behind it — a $2/day ad
    // swinging to $0 revenue isn't the "something broke" signal this is for.
    if (today.cost < 10) continue

    const { rowCount } = await db.query(
      `INSERT INTO pause_candidates (client_id, platform, ad_id, ad_name, campaign_name, reason, daily_spend, daily_revenue, baseline_roas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (client_id, platform, ad_id) WHERE status = 'pending' DO NOTHING`,
      [
        today.client_id,
        today.platform,
        today.ad_id,
        today.ad_name,
        today.campaign_name,
        `ROAS dropped to ${todayRoas === null ? '0' : todayRoas.toFixed(2)} vs. a 7-day average of ${baselineRoas.toFixed(2)} (spend $${today.cost.toFixed(2)}/day).`,
        today.cost,
        today.revenue,
        baselineRoas,
      ]
    )
    if (rowCount && rowCount > 0) {
      flagged++
      await sendAlert(
        today.client_id,
        'Underperforming ad flagged for review',
        `"${today.ad_name ?? today.ad_id}" (${today.campaign_name ?? 'no campaign'}) on ${today.platform} may be worth pausing. Review it in Pause Candidates.`
      )
    }
  }
  return flagged
}

// Returns how many anomaly alerts were sent (0 if nothing crossed a threshold for
// any client, or no client has cost/revenue history yet) — same "return a count,
// never throw" convention runAndRecord's callers already rely on for logging.
export async function detectAnomalies(): Promise<number> {
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const baselineStart = new Date(now)
  baselineStart.setUTCDate(baselineStart.getUTCDate() - 8)
  const baselineEnd = new Date(now)
  baselineEnd.setUTCDate(baselineEnd.getUTCDate() - 2)

  const [yesterdayMetrics, baselineTotals] = await Promise.all([
    getDayMetrics(isoDate(yesterday), isoDate(yesterday)),
    getDayMetrics(isoDate(baselineStart), isoDate(baselineEnd)),
  ])

  let alertsSent = 0
  for (const [clientId, today] of yesterdayMetrics) {
    const baseline = baselineTotals.get(clientId)
    if (!baseline) continue

    const baselineDailyCost = baseline.cost / 7
    const baselineDailyRevenue = baseline.revenue / 7
    const baselineRoas = baselineDailyCost > 0 ? baselineDailyRevenue / baselineDailyCost : null
    const todayRoas = today.cost > 0 ? today.revenue / today.cost : null

    const messages: string[] = []

    if (baselineDailyCost > 0) {
      const change = (today.cost - baselineDailyCost) / baselineDailyCost
      if (Math.abs(change) >= SPEND_CHANGE_THRESHOLD) {
        const direction = change > 0 ? 'up' : 'down'
        messages.push(
          `Spend ${direction} ${Math.abs(change * 100).toFixed(0)}% vs. your 7-day average ` +
            `($${today.cost.toFixed(2)} vs. ~$${baselineDailyCost.toFixed(2)}/day).`
        )
      }
    }

    if (baselineRoas !== null && baselineRoas > 0) {
      if (todayRoas === null || todayRoas < baselineRoas * ROAS_DROP_THRESHOLD) {
        messages.push(
          `ROAS dropped to ${todayRoas === null ? '0' : todayRoas.toFixed(2)} vs. your 7-day average of ${baselineRoas.toFixed(2)}.`
        )
      }
    }

    if (messages.length > 0) {
      await sendAlert(clientId, 'Ad performance alert', messages.join('\n'))
      alertsSent++
    }
  }

  const adsFlagged = await detectAdLevelAnomalies()
  return alertsSent + adsFlagged
}
