import { describe, it, expect } from 'vitest'
import { lookupGeo } from '../geo'

describe('lookupGeo', () => {
  it('resolves a known public IP to a country', () => {
    const result = lookupGeo('8.8.8.8')
    expect(result.country).toBe('US')
  })

  it('returns nulls for a missing IP', () => {
    expect(lookupGeo(null)).toEqual({ country: null, region: null })
    expect(lookupGeo(undefined)).toEqual({ country: null, region: null })
  })

  it('returns nulls rather than throwing for an unresolvable/private IP', () => {
    const result = lookupGeo('127.0.0.1')
    expect(result.country).toBeNull()
  })
})
