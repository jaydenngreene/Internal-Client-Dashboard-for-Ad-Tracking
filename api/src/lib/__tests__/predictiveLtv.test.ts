import { describe, it, expect } from 'vitest'
import { predictLifetimeValue, MaturityCurve } from '../predictiveLtv'

const curve: MaturityCurve = {
  multiplier180From30: 3,
  multiplierLifetimeFrom180: 2,
  sampleSize180: 6,
  sampleSizeLifetime: 6,
}

describe('predictLifetimeValue', () => {
  it('matches the hand-calculated example from the real Supabase verification pass', () => {
    const daysAgo = (n: number) => new Date(Date.now() - n * 86400000)
    const predicted = predictLifetimeValue(curve, {
      revenue_30d: 50,
      revenue_180d: 0,
      revenue_lifetime: 50,
      first_purchase_date: daysAgo(10),
    })
    expect(predicted).toBeCloseTo(300, 5) // 50 * 3 * 2
  })

  it('projects from revenue_180d directly once a customer is past 180 days but under 365', () => {
    const daysAgo = (n: number) => new Date(Date.now() - n * 86400000)
    const predicted = predictLifetimeValue(curve, {
      revenue_30d: 100,
      revenue_180d: 300,
      revenue_lifetime: 300,
      first_purchase_date: daysAgo(200),
    })
    expect(predicted).toBeCloseTo(600, 5) // 300 * 2, ignores revenue_30d entirely at this age
  })

  it('returns revenue_lifetime as-is once a customer is past 365 days — nothing left to predict', () => {
    const daysAgo = (n: number) => new Date(Date.now() - n * 86400000)
    const predicted = predictLifetimeValue(curve, {
      revenue_30d: 100,
      revenue_180d: 300,
      revenue_lifetime: 725,
      first_purchase_date: daysAgo(400),
    })
    expect(predicted).toBe(725)
  })

  it('returns null (not a guess) when the curve has no reliable multiplier yet', () => {
    const emptyCurve: MaturityCurve = {
      multiplier180From30: null,
      multiplierLifetimeFrom180: null,
      sampleSize180: 0,
      sampleSizeLifetime: 0,
    }
    const daysAgo = (n: number) => new Date(Date.now() - n * 86400000)
    const predicted = predictLifetimeValue(emptyCurve, {
      revenue_30d: 50,
      revenue_180d: 0,
      revenue_lifetime: 50,
      first_purchase_date: daysAgo(10),
    })
    expect(predicted).toBeNull()
  })
})
