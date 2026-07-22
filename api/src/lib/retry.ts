// Generic retry-with-backoff for anything that can fail transiently (a rate limit,
// a momentary network blip) — used by the ad-cost-sync jobs (Step 38) so one
// client's rate-limited request doesn't just burn its whole sync window until the
// next scheduled run 6 hours later.
export interface RetryOptions {
  maxAttempts?: number
  baseDelayMs?: number
  isRetryable?: (err: unknown) => boolean
}

export function isRateLimitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /429|rate limit|too many requests/i.test(message)
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3
  const baseDelayMs = opts.baseDelayMs ?? 1000
  const isRetryable = opts.isRetryable ?? isRateLimitError

  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt === maxAttempts || !isRetryable(err)) throw err
      const delay = baseDelayMs * 2 ** (attempt - 1)
      console.warn(`[retry] attempt ${attempt}/${maxAttempts} failed (${(err as Error).message}), retrying in ${delay}ms`)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  throw lastErr
}
