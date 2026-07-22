import { db } from '../db'

// Detects a within-platform ROAS gap between two of a client's own campaigns —
// a winner (high ROAS, room to scale) and a loser (low ROAS, spend that could be
// better used elsewhere) — and suggests shifting a modest slice of the loser's
// daily spend to the winner. Confirm-first by explicit user decision (same
// reasoning as Step 35's pause candidates): this only ever creates a suggestion,
// never moves budget itself.
const MIN_DAILY_SPEND = 20 // ignore campaigns too small to make a meaningful comparison
const ROAS_GAP_MULTIPLE = 1.5 // winner's ROAS must be at least 1.5x the loser's
const SHIFT_PERCENT = 0.2 // suggest moving 20% of the loser's average daily spend

interface CampaignPerf {
  client_id: string
  platform: string
  campaign_id: string
  campaign_name: string | null
  avgDailyCost: number
  avgDailyRevenue: number
  roas: number | null
}

function normalizeSource(s: string): string {
  return s.trim().toLowerCase().replace(/_ads$/, '')
}

async function getCampaignPerformance(sinceDate: string, untilDate: string, days: number): Promise<CampaignPerf[]> {
  const { rows } = await db.query<{
    client_id: string
    platform: string
    campaign_id: string
    campaign_name: string | null
    cost: string
  }>(
    `SELECT client_id, platform, campaign_id, MAX(campaign_name) AS campaign_name, SUM(spend) AS cost
     FROM ad_costs WHERE date BETWEEN $1 AND $2 AND campaign_id IS NOT NULL
     GROUP BY client_id, platform, campaign_id`,
    [sinceDate, untilDate]
  )

  const perf: CampaignPerf[] = []
  for (const r of rows) {
    const avgDailyCost = parseFloat(r.cost) / days
    if (avgDailyCost < MIN_DAILY_SPEND) continue

    const { rows: revRows } = await db.query<{ total: string }>(
      `SELECT COALESCE(SUM(a.attributed_revenue), 0) AS total
       FROM attributions a
       JOIN sessions s ON s.id = a.session_id
       JOIN purchases p ON p.id = a.purchase_id
       WHERE a.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3
         AND LOWER(REGEXP_REPLACE(s.utm_source, '_ads$', '')) = $4
         AND LOWER(TRIM(s.utm_campaign)) = (SELECT LOWER(TRIM(MAX(campaign_name))) FROM ad_costs WHERE client_id = $1 AND platform = $5 AND campaign_id = $6)`,
      [r.client_id, sinceDate, untilDate, normalizeSource(r.platform), r.platform, r.campaign_id]
    )
    const avgDailyRevenue = parseFloat(revRows[0].total) / days

    perf.push({
      client_id: r.client_id,
      platform: r.platform,
      campaign_id: r.campaign_id,
      campaign_name: r.campaign_name,
      avgDailyCost,
      avgDailyRevenue,
      roas: avgDailyCost > 0 ? avgDailyRevenue / avgDailyCost : null,
    })
  }
  return perf
}

export async function detectReallocationOpportunities(): Promise<number> {
  const until = new Date()
  until.setUTCDate(until.getUTCDate() - 1)
  const since = new Date(until)
  since.setUTCDate(since.getUTCDate() - 6) // trailing 7 days
  const days = 7

  const perf = await getCampaignPerformance(since.toISOString().slice(0, 10), until.toISOString().slice(0, 10), days)

  // Group by client+platform — reallocation only ever happens within the same
  // platform (you can't move Facebook budget into a Google campaign).
  const byClientPlatform = new Map<string, CampaignPerf[]>()
  for (const p of perf) {
    if (p.roas === null) continue
    const key = `${p.client_id}::${p.platform}`
    if (!byClientPlatform.has(key)) byClientPlatform.set(key, [])
    byClientPlatform.get(key)!.push(p)
  }

  let flagged = 0
  for (const campaigns of byClientPlatform.values()) {
    if (campaigns.length < 2) continue
    const sorted = [...campaigns].sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0))
    const winner = sorted[0]
    const loser = sorted[sorted.length - 1]
    if (winner.campaign_id === loser.campaign_id) continue
    if (!winner.roas || !loser.roas || loser.roas <= 0) continue
    if (winner.roas < loser.roas * ROAS_GAP_MULTIPLE) continue

    const shiftAmount = Math.round(loser.avgDailyCost * SHIFT_PERCENT * 100) / 100
    if (shiftAmount <= 0) continue

    const reasoning =
      `${winner.campaign_name ?? winner.campaign_id} is returning ${winner.roas.toFixed(2)}x ROAS vs. ` +
      `${loser.campaign_name ?? loser.campaign_id}'s ${loser.roas.toFixed(2)}x over the last ${days} days. ` +
      `Suggest shifting $${shiftAmount.toFixed(2)}/day of daily budget from the underperformer to the winner.`

    const { rowCount } = await db.query(
      `INSERT INTO budget_reallocation_suggestions
         (client_id, platform, from_campaign_id, from_campaign_name, from_roas, to_campaign_id, to_campaign_name, to_roas, suggested_shift_amount, reasoning)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (client_id, platform, from_campaign_id, to_campaign_id) WHERE status = 'pending' DO NOTHING`,
      [
        winner.client_id,
        winner.platform,
        loser.campaign_id,
        loser.campaign_name,
        loser.roas,
        winner.campaign_id,
        winner.campaign_name,
        winner.roas,
        shiftAmount,
        reasoning,
      ]
    )
    if (rowCount && rowCount > 0) flagged++
  }
  return flagged
}
