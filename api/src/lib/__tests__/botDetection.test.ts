import { describe, it, expect } from 'vitest'
import { detectBotUserAgent } from '../botDetection'

describe('detectBotUserAgent', () => {
  it('flags known bot/crawler signatures', () => {
    expect(detectBotUserAgent('Googlebot/2.1 (+http://www.google.com/bot.html)')).not.toBeNull()
    expect(detectBotUserAgent('Mozilla/5.0 (compatible; bingbot/2.0)')).not.toBeNull()
    expect(detectBotUserAgent('python-requests/2.31.0')).not.toBeNull()
    expect(detectBotUserAgent('curl/8.1.2')).not.toBeNull()
  })

  it('flags headless/automation signatures', () => {
    expect(detectBotUserAgent('Mozilla/5.0 HeadlessChrome/120.0.0.0')).not.toBeNull()
    expect(detectBotUserAgent('Mozilla/5.0 (compatible; selenium)')).not.toBeNull()
  })

  it('does not flag a real browser user agent', () => {
    expect(
      detectBotUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      )
    ).toBeNull()
  })

  it('returns null for a missing user agent rather than flagging it', () => {
    expect(detectBotUserAgent(null)).toBeNull()
    expect(detectBotUserAgent(undefined)).toBeNull()
    expect(detectBotUserAgent('')).toBeNull()
  })
})
