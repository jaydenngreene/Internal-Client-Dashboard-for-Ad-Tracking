import { describe, it, expect } from 'vitest'
import { timeDecayWeights, uShapedWeights } from '../attribution'

describe('timeDecayWeights', () => {
  it('weighs a touch on the day of purchase twice as much as one 7 days earlier (7-day half-life)', () => {
    const purchaseTime = new Date('2026-01-08T00:00:00Z')
    const sessions = [
      { id: 'a', utm_campaign: null, utm_content: null, utm_source: null, fbclid: null, gclid: null, msclkid: null, started_at: '2026-01-01T00:00:00Z' },
      { id: 'b', utm_campaign: null, utm_content: null, utm_source: null, fbclid: null, gclid: null, msclkid: null, started_at: '2026-01-08T00:00:00Z' },
    ]
    const weights = timeDecayWeights(sessions, purchaseTime)
    expect(weights[1] / weights[0]).toBeCloseTo(2, 5)
    expect(weights[0] + weights[1]).toBeCloseTo(1, 10)
  })

  it('splits evenly when every touch happened at the same instant', () => {
    const purchaseTime = new Date('2026-01-01T00:00:00Z')
    const sessions = Array.from({ length: 3 }, (_, i) => ({
      id: String(i),
      utm_campaign: null,
      utm_content: null,
      utm_source: null,
      fbclid: null,
      gclid: null,
      msclkid: null,
      started_at: '2026-01-01T00:00:00Z',
    }))
    const weights = timeDecayWeights(sessions, purchaseTime)
    weights.forEach((w) => expect(w).toBeCloseTo(1 / 3, 10))
  })
})

describe('uShapedWeights', () => {
  it('gives 100% to the only touch', () => {
    expect(uShapedWeights(1)).toEqual([1])
  })

  it('splits 50/50 for exactly two touches', () => {
    expect(uShapedWeights(2)).toEqual([0.5, 0.5])
  })

  it('gives 40% first, 40% last, remaining 20% split evenly across the middle', () => {
    const weights = uShapedWeights(4)
    expect(weights[0]).toBeCloseTo(0.4, 10)
    expect(weights[3]).toBeCloseTo(0.4, 10)
    expect(weights[1]).toBeCloseTo(0.1, 10)
    expect(weights[2]).toBeCloseTo(0.1, 10)
    expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
  })
})
