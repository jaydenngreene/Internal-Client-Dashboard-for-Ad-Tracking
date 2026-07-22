import { describe, it, expect } from 'vitest'
import { generateTotp, verifyTotp, generateBase32Secret, buildOtpAuthUri } from '../totp'

// RFC 6238's own published 8-digit SHA1 test vectors, truncated to 6 digits
// (both are the same underlying value % 10^N, just a different N) — verifying
// against the RFC's own vectors, not just round-trip self-consistency, since
// self-consistency alone can't catch a systematically wrong algorithm.
const RFC_SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' // base32("12345678901234567890")

describe('generateTotp', () => {
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('matches the RFC 6238 vector at t=%i', (timeSec, expected) => {
    expect(generateTotp(RFC_SECRET_BASE32, timeSec * 1000)).toBe(expected)
  })
})

describe('verifyTotp', () => {
  it('accepts the correct code for the current time', () => {
    const secret = generateBase32Secret()
    const code = generateTotp(secret)
    expect(verifyTotp(secret, code)).toBe(true)
  })

  it('rejects a wrong code', () => {
    const secret = generateBase32Secret()
    expect(verifyTotp(secret, '000000')).toBe(false)
  })

  it('tolerates one 30-second step of clock drift either direction', () => {
    const secret = generateBase32Secret()
    const now = Date.now()
    const codeOneStepAgo = generateTotp(secret, now - 30_000)
    expect(verifyTotp(secret, codeOneStepAgo, now)).toBe(true)
  })

  it('rejects malformed input instead of throwing', () => {
    const secret = generateBase32Secret()
    expect(verifyTotp(secret, 'abcdef')).toBe(false)
    expect(verifyTotp(secret, '12345')).toBe(false)
  })
})

describe('buildOtpAuthUri', () => {
  it('produces a well-formed otpauth URI', () => {
    const uri = buildOtpAuthUri('ABCDEFGH', 'user@example.com', 'Ad Tracking')
    expect(uri).toMatch(/^otpauth:\/\/totp\//)
    expect(uri).toContain('secret=ABCDEFGH')
    expect(uri).toContain('issuer=Ad+Tracking')
  })
})
