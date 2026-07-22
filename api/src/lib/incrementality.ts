import { db } from '../db'

export interface IncrementalityTest {
  id: string
  client_id: string
  platform: string
  campaign_name: string
  pre_period_days: number
  pause_start: string
  pause_end: string
  created_at: string
}

// The methodology: pausing a specific campaign and watching its OWN attributed
// revenue would be trivial and uninformative — attributed revenue for a paused
// campaign is zero by definition, that tells you nothing about incrementality.
// The real question is whether TOTAL account-wide revenue drops when the
// campaign stops running. If it does, that drop IS the campaign's true
// incremental contribution (demand that wouldn't have converted through any
// other channel). If total revenue barely moves, the campaign's attributed
// revenue was likely cannibalizing other channels or converting demand that
// would have happened anyway — the classic overstatement problem with
// last/first-click/linear MTA that pure attribution can't self-diagnose.
export interface IncrementalityResult {
  status: 'pending' | 'running' | 'completed'
  preperiodDailyTotalRevenue: number
  preperiodDailyCampaignAttributedRevenue: number
  projectedBaselineTotalRevenue: number | null
  actualTotalRevenueDuringPause: number | null
  incrementalRevenueEstimate: number | null
  incrementalityRatio: number | null // incrementalRevenueEstimate / (campaign's own historical attributed revenue over an equivalent span)
}

function normalizeSource(s: string): string {
  return s.trim().toLowerCase().replace(/_ads$/, '')
}

export async function computeIncrementalityResult(test: IncrementalityTest): Promise<IncrementalityResult> {
  const today = new Date().toISOString().slice(0, 10)
  const status: IncrementalityResult['status'] =
    today < test.pause_start ? 'pending' : today <= test.pause_end ? 'running' : 'completed'

  const preStart = new Date(test.pause_start + 'T00:00:00Z')
  preStart.setUTCDate(preStart.getUTCDate() - test.pre_period_days)
  const preEnd = new Date(test.pause_start + 'T00:00:00Z')
  preEnd.setUTCDate(preEnd.getUTCDate() - 1)
  const preStartStr = preStart.toISOString().slice(0, 10)
  const preEndStr = preEnd.toISOString().slice(0, 10)

  const [totalRevRow, campaignRevRow] = await Promise.all([
    db.query<{ total: string }>(
      `SELECT COALESCE(SUM(a.attributed_revenue), 0) AS total
       FROM attributions a JOIN purchases p ON p.id = a.purchase_id
       WHERE a.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3`,
      [test.client_id, preStartStr, preEndStr]
    ),
    db.query<{ total: string }>(
      `SELECT COALESCE(SUM(a.attributed_revenue), 0) AS total
       FROM attributions a
       JOIN sessions s ON s.id = a.session_id
       JOIN purchases p ON p.id = a.purchase_id
       WHERE a.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3
         AND LOWER(REGEXP_REPLACE(s.utm_source, '_ads$', '')) = $4
         AND LOWER(TRIM(s.utm_campaign)) = LOWER(TRIM($5))`,
      [test.client_id, preStartStr, preEndStr, normalizeSource(test.platform), test.campaign_name]
    ),
  ])

  const preperiodDailyTotalRevenue = parseFloat(totalRevRow.rows[0].total) / test.pre_period_days
  const preperiodDailyCampaignAttributedRevenue = parseFloat(campaignRevRow.rows[0].total) / test.pre_period_days

  if (status !== 'completed') {
    return {
      status,
      preperiodDailyTotalRevenue,
      preperiodDailyCampaignAttributedRevenue,
      projectedBaselineTotalRevenue: null,
      actualTotalRevenueDuringPause: null,
      incrementalRevenueEstimate: null,
      incrementalityRatio: null,
    }
  }

  const pauseDays =
    Math.round((new Date(test.pause_end).getTime() - new Date(test.pause_start).getTime()) / 86400000) + 1

  const { rows: actualRevRows } = await db.query<{ total: string }>(
    `SELECT COALESCE(SUM(a.attributed_revenue), 0) AS total
     FROM attributions a JOIN purchases p ON p.id = a.purchase_id
     WHERE a.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3`,
    [test.client_id, test.pause_start, test.pause_end]
  )

  const projectedBaselineTotalRevenue = preperiodDailyTotalRevenue * pauseDays
  const actualTotalRevenueDuringPause = parseFloat(actualRevRows[0].total)
  const incrementalRevenueEstimate = projectedBaselineTotalRevenue - actualTotalRevenueDuringPause
  const campaignHistoricalOverPauseSpan = preperiodDailyCampaignAttributedRevenue * pauseDays
  const incrementalityRatio =
    campaignHistoricalOverPauseSpan > 0 ? incrementalRevenueEstimate / campaignHistoricalOverPauseSpan : null

  return {
    status,
    preperiodDailyTotalRevenue,
    preperiodDailyCampaignAttributedRevenue,
    projectedBaselineTotalRevenue,
    actualTotalRevenueDuringPause,
    incrementalRevenueEstimate,
    incrementalityRatio,
  }
}

export async function createIncrementalityTest(
  clientId: string,
  input: { platform: string; campaignName: string; pauseStart: string; pauseEnd: string; prePeriodDays?: number }
): Promise<IncrementalityTest> {
  // node-pg returns DATE columns as JS Date objects, not strings — explicit
  // ::text casts keep pause_start/pause_end as plain YYYY-MM-DD strings the rest
  // of this module (and the DELETE/list routes) can safely do string arithmetic
  // and comparisons on, same convention reports.ts already uses everywhere else.
  const { rows } = await db.query<IncrementalityTest>(
    `INSERT INTO incrementality_tests (client_id, platform, campaign_name, pre_period_days, pause_start, pause_end)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, client_id, platform, campaign_name, pre_period_days,
               pause_start::text, pause_end::text, created_at`,
    [clientId, input.platform, input.campaignName, input.prePeriodDays ?? 30, input.pauseStart, input.pauseEnd]
  )
  return rows[0]
}
