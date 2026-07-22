// Step 49 — revenue/ROAS/CAC forecasting via ordinary-least-squares linear trend,
// deliberately not a real time-series model (no seasonality, no confidence
// intervals, no Prophet/ARIMA) — same "simple, honest, disclosed method" ethos as
// predictive LTV's cohort-curve and creative fatigue's ratio check. Good enough to
// answer "is this trending up or down, and roughly how much," not meant to be
// read as a precise prediction.
export interface TrendLine {
  slope: number
  intercept: number
}

// Standard OLS: y = intercept + slope*x, x assumed to be 0..n-1 (one point per day).
export function fitTrendLine(values: number[]): TrendLine {
  const n = values.length
  if (n === 0) return { slope: 0, intercept: 0 }
  if (n === 1) return { slope: 0, intercept: values[0] }

  const xs = Array.from({ length: n }, (_, i) => i)
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = values.reduce((a, b) => a + b, 0) / n

  let numerator = 0
  let denominator = 0
  for (let i = 0; i < n; i++) {
    numerator += (xs[i] - meanX) * (values[i] - meanY)
    denominator += (xs[i] - meanX) ** 2
  }
  const slope = denominator === 0 ? 0 : numerator / denominator
  const intercept = meanY - slope * meanX
  return { slope, intercept }
}

// Projects the SUM of the fitted trend over the next `daysAhead` days starting
// right after the historical series ends (x = n .. n+daysAhead-1) — "expected
// total revenue over the next 30 days," not just a single future day's value.
// Clamped at 0: a steeply declining trend shouldn't project negative revenue.
export function projectSum(historicalValues: number[], daysAhead: number): number {
  const n = historicalValues.length
  const { slope, intercept } = fitTrendLine(historicalValues)
  let total = 0
  for (let i = 0; i < daysAhead; i++) {
    const x = n + i
    total += Math.max(0, intercept + slope * x)
  }
  return total
}
