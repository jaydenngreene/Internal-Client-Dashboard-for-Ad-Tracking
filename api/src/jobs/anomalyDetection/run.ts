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
  return alertsSent
}
