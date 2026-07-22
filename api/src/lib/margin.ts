export interface MarginConfig {
  cogs_percent: number | string | null
  payment_fee_percent: number | string | null
  fulfillment_cost_flat: number | string | null
}

export interface TrueProfitResult {
  trueProfit: number
  trueRoi: number | null
  cogsAmount: number
  feeAmount: number
  fulfillmentAmount: number
}

// revenue/adCost/orders are all account-wide or already scoped to one breakdown row
// (a campaign, a source, a day) — the same percent-of-revenue/flat-per-order
// assumptions apply either way since they're just proportional to what's passed in.
export function computeTrueProfit(
  config: MarginConfig | null | undefined,
  revenue: number,
  adCost: number,
  orders: number
): TrueProfitResult {
  const cogsPercent = parseFloat(String(config?.cogs_percent ?? 0)) || 0
  const feePercent = parseFloat(String(config?.payment_fee_percent ?? 0)) || 0
  const fulfillmentFlat = parseFloat(String(config?.fulfillment_cost_flat ?? 0)) || 0

  const cogsAmount = revenue * (cogsPercent / 100)
  const feeAmount = revenue * (feePercent / 100)
  const fulfillmentAmount = fulfillmentFlat * orders

  const trueProfit = revenue - adCost - cogsAmount - feeAmount - fulfillmentAmount
  const trueRoi = adCost > 0 ? (trueProfit / adCost) * 100 : null

  return { trueProfit, trueRoi, cogsAmount, feeAmount, fulfillmentAmount }
}
