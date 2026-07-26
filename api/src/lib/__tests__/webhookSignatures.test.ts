import { describe, it, expect } from 'vitest'
import * as crypto from 'crypto'
import { verifyShopifyHmac } from '../../routes/webhooks/shopify'
import { verifySquareSignature } from '../../routes/webhooks/square'
import { verifyTwilioSignature } from '../../routes/webhooks/twilio'
import { verifyHousecallProSignature } from '../../routes/webhooks/housecallpro'

describe('verifyShopifyHmac', () => {
  const secret = 'shopify-test-secret'
  const rawBody = Buffer.from(JSON.stringify({ id: 123, total_price: '49.99' }))

  it('accepts a correctly computed HMAC', () => {
    const validHmac = crypto.createHmac('sha256', secret).update(rawBody).digest('base64')
    expect(verifyShopifyHmac(rawBody, validHmac, secret)).toBe(true)
  })

  it('rejects a wrong HMAC', () => {
    const wrongHmac = crypto.createHmac('sha256', 'wrong-secret').update(rawBody).digest('base64')
    expect(verifyShopifyHmac(rawBody, wrongHmac, secret)).toBe(false)
  })

  it('rejects a malformed header instead of throwing', () => {
    expect(verifyShopifyHmac(rawBody, 'not-valid-base64-or-right-length', secret)).toBe(false)
  })
})

describe('verifySquareSignature', () => {
  const config = { signature_key: 'square-test-key', notification_url: 'https://example.com/webhooks/square/client-1' }
  const rawBody = Buffer.from(JSON.stringify({ type: 'payment.updated' }))

  it('accepts a correctly computed signature (notification_url + raw body)', () => {
    const validSig = crypto
      .createHmac('sha256', config.signature_key)
      .update(config.notification_url + rawBody.toString())
      .digest('base64')
    expect(verifySquareSignature(rawBody, validSig, config)).toBe(true)
  })

  it('rejects a signature computed against a different notification_url', () => {
    const sigForWrongUrl = crypto
      .createHmac('sha256', config.signature_key)
      .update('https://attacker.example.com' + rawBody.toString())
      .digest('base64')
    expect(verifySquareSignature(rawBody, sigForWrongUrl, config)).toBe(false)
  })
})

describe('verifyTwilioSignature', () => {
  const authToken = 'twilio-test-token'
  const url = 'https://api.example.com/webhooks/twilio/client-1/voice'
  const params = { CallSid: 'CA123', From: '+15551234567', To: '+15557654321' }

  function sign(u: string, p: Record<string, string>, token: string): string {
    const sorted = Object.keys(p)
      .sort()
      .reduce((acc, key) => acc + key + p[key], u)
    return crypto.createHmac('sha1', token).update(sorted).digest('base64')
  }

  it('accepts a correctly computed signature', () => {
    expect(verifyTwilioSignature(url, params, sign(url, params, authToken), authToken)).toBe(true)
  })

  it('rejects a signature computed for a different URL (e.g. registered console URL mismatch)', () => {
    const sigForDifferentUrl = sign('https://api.example.com/webhooks/twilio/OTHER-CLIENT/voice', params, authToken)
    expect(verifyTwilioSignature(url, params, sigForDifferentUrl, authToken)).toBe(false)
  })

  it('rejects tampered params (e.g. a spoofed From number)', () => {
    const validSig = sign(url, params, authToken)
    const tamperedParams = { ...params, From: '+19995551234' }
    expect(verifyTwilioSignature(url, tamperedParams, validSig, authToken)).toBe(false)
  })
})

describe('verifyHousecallProSignature', () => {
  const config = { webhook_secret: 'hcp-test-secret' }
  const rawBody = Buffer.from(JSON.stringify({ event: 'invoice.paid' }))

  it('accepts a correctly computed HMAC-SHA256 hex signature over the raw body', () => {
    const validSig = crypto.createHmac('sha256', config.webhook_secret).update(rawBody).digest('hex')
    expect(verifyHousecallProSignature(rawBody, validSig, config)).toBe(true)
  })

  it('rejects a signature computed with the wrong secret', () => {
    const wrongSig = crypto.createHmac('sha256', 'wrong-secret').update(rawBody).digest('hex')
    expect(verifyHousecallProSignature(rawBody, wrongSig, config)).toBe(false)
  })

  it('rejects a malformed header instead of throwing', () => {
    expect(verifyHousecallProSignature(rawBody, 'not-a-real-signature', config)).toBe(false)
  })
})
