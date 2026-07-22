import * as crypto from 'crypto'

// RFC 6238 TOTP, hand-rolled with Node's built-in crypto rather than a third-
// party library — otplib's current major version ships a breaking, unstable
// plugin architecture (crypto/base32 plugins that don't work out of the box);
// the actual algorithm here is small and well-specified enough that
// implementing it directly is more reliable than fighting an unstable API,
// same "prefer the simple, dependency-free version" choice as lib/linearAlgebra.ts.
const PERIOD_SECONDS = 30
const DIGITS = 6
const WINDOW = 1 // accept the previous/current/next 30s step, tolerating clock drift

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function generateBase32Secret(byteLength = 20): string {
  const bytes = crypto.randomBytes(byteLength)
  let bits = ''
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0')
  let secret = ''
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    secret += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)]
  }
  return secret
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '')
  let bits = ''
  for (const char of clean) {
    const val = BASE32_ALPHABET.indexOf(char)
    if (val === -1) continue
    bits += val.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2))
  }
  return Buffer.from(bytes)
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8)
  buf.writeBigInt64BE(BigInt(counter))
  const hmac = crypto.createHmac('sha1', secret).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binCode =
    ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff)
  return String(binCode % 10 ** DIGITS).padStart(DIGITS, '0')
}

export function generateTotp(base32Secret: string, at: number = Date.now()): string {
  const counter = Math.floor(at / 1000 / PERIOD_SECONDS)
  return hotp(base32Decode(base32Secret), counter)
}

// Accepts a code from the current step or +/-WINDOW steps either side, so a
// slightly-off device clock doesn't lock someone out.
export function verifyTotp(base32Secret: string, token: string, at: number = Date.now()): boolean {
  if (!/^\d{6}$/.test(token)) return false
  const secretBytes = base32Decode(base32Secret)
  const counter = Math.floor(at / 1000 / PERIOD_SECONDS)
  for (let errorWindow = -WINDOW; errorWindow <= WINDOW; errorWindow++) {
    if (hotp(secretBytes, counter + errorWindow) === token) return true
  }
  return false
}

export function buildOtpAuthUri(base32Secret: string, accountLabel: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`)
  const params = new URLSearchParams({ secret: base32Secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(PERIOD_SECONDS) })
  return `otpauth://totp/${label}?${params.toString()}`
}
