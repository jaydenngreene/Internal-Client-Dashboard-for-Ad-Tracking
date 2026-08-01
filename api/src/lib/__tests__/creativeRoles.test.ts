import { describe, it, expect } from 'vitest'
import { classifyRole } from '../creativeRoles'

describe('classifyRole', () => {
  it('picks the single role with the highest count', () => {
    expect(classifyRole(5, 1, 1)).toBe('opener')
    expect(classifyRole(1, 5, 1)).toBe('closer')
    expect(classifyRole(1, 1, 5)).toBe('assist')
  })

  it('calls it multi_role when two or more roles tie for the top count', () => {
    expect(classifyRole(3, 3, 1)).toBe('multi_role')
    expect(classifyRole(2, 2, 2)).toBe('multi_role')
  })

  it('a single-touch journey (opener and closer both 1, no assist) is multi_role, not opener', () => {
    // The one creative in a 1-touch journey is credited as both opener and
    // closer (see computeCreativeRoles) - with no assists to break the tie,
    // that's a legitimate multi_role rather than an arbitrary pick of one.
    expect(classifyRole(1, 1, 0)).toBe('multi_role')
  })
})
