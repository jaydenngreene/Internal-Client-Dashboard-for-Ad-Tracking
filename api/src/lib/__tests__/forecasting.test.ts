import { describe, it, expect } from 'vitest'
import { fitTrendLine, projectSum } from '../forecasting'

describe('fitTrendLine', () => {
  it('fits a perfect flat line', () => {
    const { slope, intercept } = fitTrendLine([100, 100, 100, 100])
    expect(slope).toBeCloseTo(0, 10)
    expect(intercept).toBeCloseTo(100, 10)
  })

  it('fits a perfect linear increase', () => {
    // y = 10 + 5x for x = 0..4 -> [10, 15, 20, 25, 30]
    const { slope, intercept } = fitTrendLine([10, 15, 20, 25, 30])
    expect(slope).toBeCloseTo(5, 10)
    expect(intercept).toBeCloseTo(10, 10)
  })

  it('handles a single data point as a flat line', () => {
    const { slope, intercept } = fitTrendLine([42])
    expect(slope).toBe(0)
    expect(intercept).toBe(42)
  })
})

describe('projectSum', () => {
  it('projects a flat trend forward as a simple multiplication', () => {
    const total = projectSum([100, 100, 100, 100], 30)
    expect(total).toBeCloseTo(3000, 5)
  })

  it('projects a rising trend correctly (sum of an arithmetic sequence)', () => {
    // y = 10 + 5x, historical x=0..4, forecast starts at x=5 for 3 more days: x=5,6,7 -> 35,40,45
    const total = projectSum([10, 15, 20, 25, 30], 3)
    expect(total).toBeCloseTo(35 + 40 + 45, 5)
  })

  it('clamps negative projections to zero instead of going negative', () => {
    // Steeply declining trend that would go negative quickly
    const total = projectSum([100, 50, 0], 10)
    expect(total).toBeGreaterThanOrEqual(0)
  })
})
