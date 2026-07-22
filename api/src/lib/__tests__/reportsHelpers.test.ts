import { describe, it, expect } from 'vitest'
import { defaultRange, previousPeriod } from '../../routes/reports'

describe('defaultRange', () => {
  it('passes through explicit from/to unchanged', () => {
    expect(defaultRange('2026-01-01', '2026-01-31')).toEqual({ from: '2026-01-01', to: '2026-01-31' })
  })

  it('defaults to a trailing 30-day window (inclusive) ending today when neither is given', () => {
    const { from, to } = defaultRange()
    const days = (new Date(to).getTime() - new Date(from).getTime()) / 86400000
    expect(days).toBe(29)
    expect(to).toBe(new Date().toISOString().slice(0, 10))
  })
})

describe('previousPeriod', () => {
  it('returns a same-length window immediately preceding the given range', () => {
    const { prevFrom, prevTo } = previousPeriod('2026-02-01', '2026-02-10')
    // 2026-02-01..10 is 10 days; the previous period should be the 10 days right before it
    expect(prevTo).toBe('2026-01-31')
    expect(prevFrom).toBe('2026-01-22')
  })

  it('handles a single-day range', () => {
    const { prevFrom, prevTo } = previousPeriod('2026-03-15', '2026-03-15')
    expect(prevTo).toBe('2026-03-14')
    expect(prevFrom).toBe('2026-03-14')
  })
})
