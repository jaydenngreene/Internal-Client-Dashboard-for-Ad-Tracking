import { describe, it, expect } from 'vitest'
import jwt from 'jsonwebtoken'
import { hashPassword, verifyPassword, signToken, verifyToken } from '../auth'

describe('password hashing', () => {
  it('verifies a password against its own hash', async () => {
    const hash = await hashPassword('correct-horse-battery-staple')
    expect(await verifyPassword('correct-horse-battery-staple', hash)).toBe(true)
  })

  it('rejects the wrong password against a real hash', async () => {
    const hash = await hashPassword('correct-horse-battery-staple')
    expect(await verifyPassword('wrong-password', hash)).toBe(false)
  })

  it('never stores the password in plaintext', async () => {
    const hash = await hashPassword('correct-horse-battery-staple')
    expect(hash).not.toContain('correct-horse-battery-staple')
  })

  it('produces a different hash for the same password each time (real salting)', async () => {
    const hashA = await hashPassword('same-password')
    const hashB = await hashPassword('same-password')
    expect(hashA).not.toBe(hashB)
  })
})

describe('JWT sign/verify — the core of every ownership check in the app', () => {
  it('round-trips a userId through sign then verify', () => {
    const token = signToken('11111111-1111-1111-1111-111111111111')
    const decoded = verifyToken(token)
    expect(decoded).toEqual({ userId: '11111111-1111-1111-1111-111111111111' })
  })

  it('rejects a garbage token', () => {
    expect(verifyToken('not.a.real.token')).toBeNull()
  })

  it('rejects a token signed with a different secret (forged token)', () => {
    // Same shape as signToken, deliberately wrong secret — this is exactly the
    // attack a stolen/guessed secret would attempt.
    const forged = jwt.sign({ userId: 'attacker' }, 'wrong-secret')
    expect(verifyToken(forged)).toBeNull()
  })

  it('rejects a token with no userId claim', () => {
    const malformed = jwt.sign({ notUserId: 'x' }, process.env.JWT_SECRET as string)
    expect(verifyToken(malformed)).toBeNull()
  })
})
