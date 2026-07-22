import { describe, it, expect } from 'vitest'
import { withRetry, isRateLimitError } from '../retry'

describe('isRateLimitError', () => {
  it('matches common rate-limit error shapes', () => {
    expect(isRateLimitError(new Error('429'))).toBe(true)
    expect(isRateLimitError(new Error('Rate limit exceeded, try again later'))).toBe(true)
    expect(isRateLimitError(new Error('Too Many Requests'))).toBe(true)
  })

  it('does not match unrelated errors', () => {
    expect(isRateLimitError(new Error('Invalid OAuth access token'))).toBe(false)
    expect(isRateLimitError(new Error('ECONNREFUSED'))).toBe(false)
  })
})

describe('withRetry', () => {
  it('retries a rate-limit-shaped failure until it succeeds', async () => {
    let attempts = 0
    const result = await withRetry(
      async () => {
        attempts++
        if (attempts < 3) throw new Error('429 Too Many Requests')
        return 'ok'
      },
      { maxAttempts: 3, baseDelayMs: 1 }
    )
    expect(result).toBe('ok')
    expect(attempts).toBe(3)
  })

  it('fails immediately on a non-retryable error, without retrying', async () => {
    let attempts = 0
    await expect(
      withRetry(
        async () => {
          attempts++
          throw new Error('Invalid credentials')
        },
        { maxAttempts: 3, baseDelayMs: 1 }
      )
    ).rejects.toThrow('Invalid credentials')
    expect(attempts).toBe(1)
  })

  it('gives up after maxAttempts even if every failure is retryable', async () => {
    let attempts = 0
    await expect(
      withRetry(
        async () => {
          attempts++
          throw new Error('429')
        },
        { maxAttempts: 3, baseDelayMs: 1 }
      )
    ).rejects.toThrow('429')
    expect(attempts).toBe(3)
  })
})
