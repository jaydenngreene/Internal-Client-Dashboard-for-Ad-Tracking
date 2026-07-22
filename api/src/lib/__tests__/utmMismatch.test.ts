import { describe, it, expect } from 'vitest'
import { levenshtein } from '../utmMismatch'

describe('levenshtein', () => {
  it('is 0 for identical strings', () => {
    expect(levenshtein('summer sale', 'summer sale')).toBe(0)
  })

  it('catches a single-character typo', () => {
    expect(levenshtein('summer sale', 'summer sal')).toBe(1)
    expect(levenshtein('summer sale', 'summar sale')).toBe(1)
  })

  it('is the full length when comparing against an empty string', () => {
    expect(levenshtein('', 'campaign')).toBe(8)
    expect(levenshtein('campaign', '')).toBe(8)
  })

  it('is large for genuinely different names, not just a typo', () => {
    expect(levenshtein('summer sale', 'winter clearance')).toBeGreaterThan(5)
  })
})
