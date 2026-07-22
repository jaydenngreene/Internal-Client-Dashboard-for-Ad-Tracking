import { describe, it, expect } from 'vitest'
import { computeTrueProfit } from '../margin'

describe('computeTrueProfit', () => {
  it('matches ad-cost-only profit when no margin config is set', () => {
    const result = computeTrueProfit(null, 500, 100, 1)
    expect(result.trueProfit).toBe(400)
    expect(result.trueRoi).toBe(400)
  })

  it('matches the hand-calculated example from the real Supabase verification pass', () => {
    // $500 revenue, $100 ad cost, 1 order, 30% cogs, 2.9% payment fee, $4.50 flat fulfillment
    // -> 500 - 100 - 150 - 14.5 - 4.5 = 231
    const result = computeTrueProfit(
      { cogs_percent: 30, payment_fee_percent: 2.9, fulfillment_cost_flat: 4.5 },
      500,
      100,
      1
    )
    expect(result.trueProfit).toBeCloseTo(231, 5)
    expect(result.trueRoi).toBeCloseTo(231, 5)
  })

  it('scales fulfillment cost by order count, not just revenue', () => {
    const oneOrder = computeTrueProfit({ cogs_percent: 0, payment_fee_percent: 0, fulfillment_cost_flat: 5 }, 1000, 0, 1)
    const tenOrders = computeTrueProfit({ cogs_percent: 0, payment_fee_percent: 0, fulfillment_cost_flat: 5 }, 1000, 0, 10)
    expect(oneOrder.trueProfit).toBe(995)
    expect(tenOrders.trueProfit).toBe(950)
  })

  it('returns a null trueRoi when there is no ad cost to divide by', () => {
    const result = computeTrueProfit({ cogs_percent: 10, payment_fee_percent: 0, fulfillment_cost_flat: 0 }, 500, 0, 1)
    expect(result.trueRoi).toBeNull()
  })
})
