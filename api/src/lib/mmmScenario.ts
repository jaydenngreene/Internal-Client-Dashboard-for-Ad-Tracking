import { db } from '../db'
import { fitMultipleRegression, rSquared } from './linearAlgebra'

// A saturation-curve budget scenario simulator — the concrete gap Northbeam's
// MMM+ closes over a naive linear MMM (computeMMM in mmm.ts, left untouched and
// still the number the Media Mix Model page shows): fits revenue against
// ln(1+spend) per platform instead of raw spend, so the fitted curve itself has
// diminishing returns baked in. That means "move $X/day from platform A to
// platform B" produces a genuinely different projected delta depending on how
// saturated each platform's current spend already is — a channel with a lot of
// spend and a flattening curve gains less from an extra dollar than one still on
// the steep part of its curve, which a straight-line coefficient can't represent
// at all. Still a real regression fit to real history, not a simulation of
// consumer behavior or a black-box model — same "simple, honest, disclosed
// method" ethos as every other model in this app (predictive LTV, creative
// fatigue, forecasting, the linear MMM itself).
const LOOKBACK_DAYS = 90
const MIN_DAYS = 30

export interface ScenarioAdjustment {
  platform: string
  spendDelta: number // proposed +/- change to that platform's average daily spend
}

export interface ChannelScenarioDetail {
  platform: string
  currentDailySpend: number
  scenarioDailySpend: number
  // Coefficient is "revenue per unit of ln(1+dailySpend)," not a flat $-per-$ —
  // deliberately not labeled the same as the linear MMM's coefficientPerDollar,
  // since treating it as a flat rate would misrepresent the whole point of a
  // saturation curve.
  saturationCoefficient: number
}

export interface MmmScenarioResult {
  available: boolean
  reason?: string
  rSquared?: number
  sampleSizeDays?: number
  currentProjectedDailyRevenue?: number
  scenarioProjectedDailyRevenue?: number
  projectedDailyRevenueDelta?: number
  channels?: ChannelScenarioDetail[]
}

export async function computeMmmScenario(
  clientId: string,
  adjustments: ScenarioAdjustment[]
): Promise<MmmScenarioResult> {
  const until = new Date()
  const since = new Date(until)
  since.setUTCDate(since.getUTCDate() - (LOOKBACK_DAYS - 1))
  const sinceStr = since.toISOString().slice(0, 10)
  const untilStr = until.toISOString().slice(0, 10)

  const [platformRows, revenueRows] = await Promise.all([
    db.query<{ platform: string; date: string; spend: string }>(
      `SELECT platform, date::text, SUM(spend) AS spend FROM ad_costs
       WHERE client_id = $1 AND date BETWEEN $2 AND $3
       GROUP BY platform, date`,
      [clientId, sinceStr, untilStr]
    ),
    db.query<{ date: string; total: string }>(
      `SELECT p.purchased_at::date::text AS date, SUM(a.attributed_revenue) AS total
       FROM attributions a JOIN purchases p ON p.id = a.purchase_id
       WHERE a.client_id = $1 AND p.purchased_at::date BETWEEN $2 AND $3
       GROUP BY p.purchased_at::date`,
      [clientId, sinceStr, untilStr]
    ),
  ])

  const platforms = Array.from(new Set(platformRows.rows.map((r) => r.platform))).sort()
  if (platforms.length < 2) {
    return { available: false, reason: 'Needs at least 2 ad platforms with spend history so we can tell their impact apart.' }
  }

  const spendByDay = new Map<string, Map<string, number>>()
  for (const r of platformRows.rows) {
    if (!spendByDay.has(r.date)) spendByDay.set(r.date, new Map())
    spendByDay.get(r.date)!.set(r.platform, parseFloat(r.spend))
  }
  const revenueByDay = new Map(revenueRows.rows.map((r) => [r.date, parseFloat(r.total)]))

  const dates: string[] = []
  for (let d = new Date(since); d <= until; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10))
  }
  if (dates.length < MIN_DAYS) {
    return { available: false, reason: `Needs at least ${MIN_DAYS} days of history, only ${dates.length} available.` }
  }

  // ln(1+spend) rather than ln(spend) so a $0 day is defined (ln(1)=0) instead of
  // producing -Infinity.
  const rawSpend: number[][] = []
  const y: number[] = []
  for (const date of dates) {
    const daySpend = spendByDay.get(date)
    rawSpend.push(platforms.map((p) => daySpend?.get(p) ?? 0))
    y.push(revenueByDay.get(date) ?? 0)
  }

  const usablePlatforms: string[] = []
  const usableIdx: number[] = []
  for (let i = 0; i < platforms.length; i++) {
    const values = rawSpend.map((row) => row[i])
    const variance = new Set(values.map((v) => v.toFixed(2))).size > 1
    if (variance) {
      usablePlatforms.push(platforms[i])
      usableIdx.push(i)
    }
  }
  if (usablePlatforms.length < 2) {
    return { available: false, reason: 'Your day-to-day spend on each platform has stayed too similar to tell their impact apart. Try again once spend has moved around more.' }
  }

  const Xlog = rawSpend.map((row) => [1, ...usableIdx.map((i) => Math.log(1 + row[i]))])

  try {
    const beta = fitMultipleRegression(Xlog, y)
    const r2 = rSquared(Xlog, y, beta)

    const avgSpend = usablePlatforms.map((_, i) => {
      const values = rawSpend.map((row) => row[usableIdx[i]])
      return values.reduce((a, b) => a + b, 0) / values.length
    })

    const scenarioSpend = usablePlatforms.map((platform, i) => {
      const adj = adjustments.find((a) => a.platform === platform)
      return Math.max(0, avgSpend[i] + (adj?.spendDelta ?? 0))
    })

    function projectedRevenue(spend: number[]): number {
      return beta[0] + usablePlatforms.reduce((sum, _, i) => sum + beta[i + 1] * Math.log(1 + spend[i]), 0)
    }

    const currentProjected = projectedRevenue(avgSpend)
    const scenarioProjected = projectedRevenue(scenarioSpend)

    const channels: ChannelScenarioDetail[] = usablePlatforms.map((platform, i) => ({
      platform,
      currentDailySpend: avgSpend[i],
      scenarioDailySpend: scenarioSpend[i],
      saturationCoefficient: beta[i + 1],
    }))

    return {
      available: true,
      rSquared: r2,
      sampleSizeDays: dates.length,
      currentProjectedDailyRevenue: currentProjected,
      scenarioProjectedDailyRevenue: scenarioProjected,
      projectedDailyRevenueDelta: scenarioProjected - currentProjected,
      channels,
    }
  } catch (err) {
    return { available: false, reason: (err as Error).message }
  }
}
