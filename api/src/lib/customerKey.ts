// Kado keys every customer by `email` (purchases, identities, leads, customer_ltv
// all join on it). Some buyers check out with only a phone number, and those
// orders used to be dropped entirely. They now get a stable stand-in key built
// from the phone, "phone:+14045551234", in that same email column, so repeat
// orders, LTV and attribution all keep working for them.
//
// Anything that sends `email` OUT of Kado as a real address (Meta/Google/TikTok
// conversion APIs, audience sync, outbound webhooks) must check isPhoneKey()
// first and send the phone instead, never the stand-in key.

const PREFIX = 'phone:'

// Digits with a leading +, US/Canada assumed for bare 10-digit numbers (the
// same assumption Shopify's own checkout makes for a US store). Returns null
// for anything too short to be a real number.
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  let digits = raw.replace(/\D/g, '')
  if (digits.length === 10) digits = `1${digits}`
  if (digits.length < 11 || digits.length > 15) return null
  return `+${digits}`
}

export function phoneCustomerKey(raw: string | null | undefined): string | null {
  const phone = normalizePhone(raw)
  return phone ? `${PREFIX}${phone}` : null
}

export function isPhoneKey(value: string | null | undefined): boolean {
  return !!value && value.startsWith(PREFIX)
}

export function phoneFromKey(value: string | null | undefined): string | null {
  return isPhoneKey(value) ? value!.slice(PREFIX.length) : null
}

// The real email to send to an outside system, or null for a phone-only customer.
export function realEmail(value: string | null | undefined): string | null {
  return value && !isPhoneKey(value) ? value : null
}
