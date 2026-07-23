import { db } from '../db'
import { fitMultipleRegression, rSquared } from './linearAlgebra'

// Media Mix Modeling — deliberately a straightforward multiple linear regression
// (revenue ~ intercept + sum of per-platform spend coefficients), NOT a Bayesian
// model with adstock/saturation curves the way Northbeam's MMM+ actually works.
// Same "simple, honest, disclosed method" ethos as predictive LTV/creative
// fatigue/forecasting — a naive regression like this is a real, recognized
// starting point for MMM (this is genuinely how many lighter-weight MMM tools
// begin before graduating to more sophisticated methods), but it WILL mislead if
// trusted blindly: too little data, too little spend variance, or two platforms
// whose budgets always move together (collinearity) all break it. rSquared and
// sampleSize are returned specifically so a low-confidence fit is visible, not
// hidden behind a confident-looking coefficient.
const LOOKBACK_DAYS = 90
const MIN_DAYS = 30 // below this, don't even attempt a fit

export interface ChannelContribution {
  platform: string
  coefficientPerDollar: number // marginal revenue per additional $1/day of spend on this platform, holding others constant
  avgDailySpend: number
}

export interface MmmResult {
  available: boolean
  reason?: string
  sampleSizeDays?: number
  rSquared?: number
  intercept?: number
  channels?: ChannelContribution[]
}

export async function computeMMM(clientId: string): Promise<MmmResult> {
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

  const X: number[][] = []
  const y: number[] = []
  for (const date of dates) {
    const daySpend = spendByDay.get(date)
    const row = [1, ...platforms.map((p) => daySpend?.get(p) ?? 0)]
    X.push(row)
    y.push(revenueByDay.get(date) ?? 0)
  }

  // A platform with zero spend variance over the window can't have its
  // coefficient separated from the intercept — drop it rather than let the
  // regression silently produce a meaningless number for it.
  const usablePlatforms: string[] = []
  const usableColumns: number[] = [0]
  for (let i = 0; i < platforms.length; i++) {
    const col = i + 1
    const values = X.map((row) => row[col])
    const variance = new Set(values.map((v) => v.toFixed(2))).size > 1
    if (variance) {
      usablePlatforms.push(platforms[i])
      usableColumns.push(col)
    }
  }
  if (usablePlatforms.length < 2) {
    return { available: false, reason: 'Your day-to-day spend on each platform has stayed too similar to tell their impact apart. Try again once spend has moved around more.' }
  }
  const Xfiltered = X.map((row) => usableColumns.map((c) => row[c]))

  try {
    const beta = fitMultipleRegression(Xfiltered, y)
    const r2 = rSquared(Xfiltered, y, beta)

    const channels: ChannelContribution[] = usablePlatforms.map((platform, i) => {
      const values = Xfiltered.map((row) => row[i + 1])
      const avgDailySpend = values.reduce((a, b) => a + b, 0) / values.length
      return { platform, coefficientPerDollar: beta[i + 1], avgDailySpend }
    })

    return {
      available: true,
      sampleSizeDays: dates.length,
      rSquared: r2,
      intercept: beta[0],
      channels: channels.sort((a, b) => b.coefficientPerDollar - a.coefficientPerDollar),
    }
  } catch (err) {
    return { available: false, reason: (err as Error).message }
  }
}
