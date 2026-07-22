import geoip from 'geoip-lite'

// Step 53 — IP-geolocation, the prerequisite this app was missing for true
// geo-lift/holdout testing (confirmed absent while scoping Step 45 earlier this
// session, which built a time-based pause test instead). geoip-lite bundles a
// free, offline MaxMind GeoLite2-derived database — no API key, no external call
// per lookup, no new vendor account, same "prefer no new vendor" preference the
// user set choosing Twilio over Deepgram and open.er-api.com for currency.
export interface GeoLocation {
  country: string | null
  region: string | null
}

// Loopback/private-range IPs (local dev, or a misconfigured proxy not forwarding
// the real client IP) resolve to nothing rather than a wrong guess.
export function lookupGeo(ip: string | null | undefined): GeoLocation {
  if (!ip) return { country: null, region: null }
  const result = geoip.lookup(ip)
  if (!result) return { country: null, region: null }
  return { country: result.country || null, region: result.region || null }
}
