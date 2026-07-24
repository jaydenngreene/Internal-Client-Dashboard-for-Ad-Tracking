import * as crypto from 'crypto'
import { services } from 'google-ads-api'
import { db } from '../db'
import { getGoogleAdsCustomer } from './googleAdsClient'
import { getBingAccessToken, bingAuthHeaders, BingAdsClientConfig } from './bingAdsClient'

export type SignalEventType = 'Purchase' | 'Lead' | 'ViewContent' | 'AddToCart' | 'InitiateCheckout'

export interface SignalPayload {
  eventType: SignalEventType
  email?: string | null
  value?: number | null
  currency?: string
  fbclid?: string | null
  gclid?: string | null
  msclkid?: string | null
  ip?: string | null
  userAgent?: string | null
  eventTime: Date
  // Meta de-dupes a Purchase reported by both a client's own browser-side Meta
  // pixel AND this app's server-side CAPI call by matching event_id between the
  // two - without it, a client running their own native pixel alongside this
  // app's CAPI integration gets every purchase double-counted in Meta's own
  // Ads Manager reporting (not in this app's numbers, just Meta's). Falls back
  // to a random id (no dedup, previous behavior) when omitted.
  eventId?: string
}

interface FacebookCapiConfig {
  pixel_id: string
  access_token: string
}

interface GoogleAdsSignalConfig {
  customer_id: string
  login_customer_id?: string
  refresh_token?: string
  conversion_action_purchase?: string
  conversion_action_lead?: string
}

interface TikTokEventsConfig {
  advertiser_id: string
  pixel_code: string
  access_token: string
}

interface SnapchatCapiConfig {
  pixel_id: string
  access_token: string
}

interface PinterestConversionConfig {
  access_token: string
  ad_account_id: string
}

// LinkedIn's Conversions API is a conversion-matching feature like Google Enhanced
// Conversions, not a full funnel-stage vocabulary — needs a pre-created "conversion"
// object per outcome type in Campaign Manager, so separate purchase/lead ids
// (mirrors GoogleAdsSignalConfig's conversion_action_purchase/lead split).
interface LinkedInConversionConfig {
  access_token: string
  conversion_id_purchase?: string
  conversion_id_lead?: string
}

interface RedditConversionConfig {
  access_token: string
  account_id: string
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value.toLowerCase().trim()).digest('hex')
}

const FB_GRAPH_VERSION = process.env.FB_GRAPH_API_VERSION ?? 'v21.0'

async function sendFacebookCapi(config: FacebookCapiConfig, payload: SignalPayload): Promise<void> {
  const userData: Record<string, unknown> = {}
  if (payload.email) userData.em = [sha256(payload.email)]
  if (payload.ip) userData.client_ip_address = payload.ip
  if (payload.userAgent) userData.client_user_agent = payload.userAgent
  // Best-effort fbc — not the real _fbc cookie Meta's own browser pixel would set
  // (we never had access to that), constructed from the fbclid we captured instead.
  if (payload.fbclid) userData.fbc = `fb.1.${payload.eventTime.getTime()}.${payload.fbclid}`

  const body = {
    data: [
      {
        event_name: payload.eventType,
        event_time: Math.floor(payload.eventTime.getTime() / 1000),
        event_id: payload.eventId ?? crypto.randomUUID(),
        action_source: 'website',
        user_data: userData,
        custom_data: {
          value: payload.value ?? undefined,
          currency: payload.currency ?? 'USD',
        },
      },
    ],
  }

  const res = await fetch(
    `https://graph.facebook.com/${FB_GRAPH_VERSION}/${config.pixel_id}/events?access_token=${encodeURIComponent(config.access_token)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Facebook CAPI request failed (${res.status}): ${text}`)
  }
}

function formatGoogleConversionTime(date: Date): string {
  // Google Ads API wants "yyyy-MM-dd HH:mm:ss+00:00"
  const iso = date.toISOString() // e.g. 2026-07-21T12:34:56.000Z
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}+00:00`
}

// Enhanced Conversions matches conversions, not general funnel-stage signals — only
// Purchase/Lead apply here (unlike Facebook CAPI, which accepts the full event vocabulary).
async function sendGoogleEnhancedConversion(config: GoogleAdsSignalConfig, payload: SignalPayload): Promise<void> {
  const actionResource =
    payload.eventType === 'Purchase' ? config.conversion_action_purchase : config.conversion_action_lead
  if (!actionResource || !payload.gclid) return

  const customer = getGoogleAdsCustomer(config)

  const request: services.IUploadClickConversionsRequest = {
    customer_id: config.customer_id,
    conversions: [
      {
        gclid: payload.gclid,
        conversion_action: actionResource,
        conversion_date_time: formatGoogleConversionTime(payload.eventTime),
        conversion_value: payload.value ?? 0,
        currency_code: payload.currency ?? 'USD',
        user_identifiers: payload.email ? [{ hashed_email: sha256(payload.email) }] : [],
      },
    ],
    partial_failure: true,
  }

  // The generated method signature wants the protobuf message class (with its
  // internal toJSON/etc), but a plain object matching the I-prefixed interface is
  // exactly what protobuf.js accepts at runtime — this cast is the documented way
  // to call these generated services with plain data.
  await customer.conversionUploads.uploadClickConversions(
    request as unknown as services.UploadClickConversionsRequest
  )
}

// TikTok's Events API v1.3 and Snapchat's Conversions API v3 each use their own
// standard-event vocabulary rather than Meta's — mapped once here rather than at
// each call site. Unverified against a live ad account (no maintained npm wrapper
// exists for either, hand-rolled against their documented REST shape) — same
// disclosure Facebook/Google carried before real credentials existed (Step 5).
const TIKTOK_EVENT_NAME: Record<SignalEventType, string> = {
  Purchase: 'CompletePayment',
  Lead: 'CompleteRegistration',
  ViewContent: 'ViewContent',
  AddToCart: 'AddToCart',
  InitiateCheckout: 'InitiateCheckout',
}

const TIKTOK_API_VERSION = 'v1.3'

async function sendTikTokEvents(config: TikTokEventsConfig, payload: SignalPayload): Promise<void> {
  const body = {
    event_source: 'web',
    event_source_id: config.pixel_code,
    data: [
      {
        event: TIKTOK_EVENT_NAME[payload.eventType],
        event_time: Math.floor(payload.eventTime.getTime() / 1000),
        event_id: crypto.randomUUID(),
        user: {
          email: payload.email ? [sha256(payload.email)] : undefined,
          ip: payload.ip ?? undefined,
          user_agent: payload.userAgent ?? undefined,
        },
        properties: {
          value: payload.value ?? undefined,
          currency: payload.currency ?? 'USD',
        },
      },
    ],
  }

  const res = await fetch(`https://business-api.tiktok.com/open_api/${TIKTOK_API_VERSION}/event/track/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Access-Token': config.access_token },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`TikTok Events API request failed (${res.status}): ${text}`)
  }
}

const SNAPCHAT_EVENT_NAME: Record<SignalEventType, string> = {
  Purchase: 'PURCHASE',
  Lead: 'SIGN_UP',
  ViewContent: 'VIEW_CONTENT',
  AddToCart: 'ADD_CART',
  InitiateCheckout: 'START_CHECKOUT',
}

async function sendSnapchatCapi(config: SnapchatCapiConfig, payload: SignalPayload): Promise<void> {
  const body = {
    data: [
      {
        event_name: SNAPCHAT_EVENT_NAME[payload.eventType],
        event_time: Math.floor(payload.eventTime.getTime() / 1000),
        event_id: crypto.randomUUID(),
        action_source: 'WEBSITE',
        user_data: {
          em: payload.email ? [sha256(payload.email)] : undefined,
          client_ip_address: payload.ip ?? undefined,
          client_user_agent: payload.userAgent ?? undefined,
        },
        custom_data: {
          value: payload.value ?? undefined,
          currency: payload.currency ?? 'USD',
        },
      },
    ],
  }

  const res = await fetch(
    `https://tr.snapchat.com/v3/${config.pixel_id}/events?access_token=${encodeURIComponent(config.access_token)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Snapchat Conversions API request failed (${res.status}): ${text}`)
  }
}

const PINTEREST_EVENT_NAME: Record<SignalEventType, string> = {
  Purchase: 'checkout',
  Lead: 'lead',
  ViewContent: 'page_visit',
  AddToCart: 'add_to_cart',
  InitiateCheckout: 'custom',
}

async function sendPinterestConversion(config: PinterestConversionConfig, payload: SignalPayload): Promise<void> {
  const body = {
    data: [
      {
        event_name: PINTEREST_EVENT_NAME[payload.eventType],
        action_source: 'web',
        event_time: Math.floor(payload.eventTime.getTime() / 1000),
        event_id: crypto.randomUUID(),
        user_data: {
          em: payload.email ? [sha256(payload.email)] : undefined,
          client_ip_address: payload.ip ?? undefined,
          client_user_agent: payload.userAgent ?? undefined,
        },
        custom_data: {
          value: payload.value ?? undefined,
          currency: payload.currency ?? 'USD',
        },
      },
    ],
  }

  const res = await fetch(`https://api.pinterest.com/v5/ad_accounts/${config.ad_account_id}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.access_token}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Pinterest Conversions API request failed (${res.status}): ${text}`)
  }
}

// Purchase/Lead only, same reason Google Enhanced Conversions is gated that way —
// this is conversion-matching, not general funnel-stage signals.
async function sendLinkedInConversion(config: LinkedInConversionConfig, payload: SignalPayload): Promise<void> {
  const conversionId =
    payload.eventType === 'Purchase' ? config.conversion_id_purchase : config.conversion_id_lead
  if (!conversionId || !payload.email) return

  const body = {
    conversion: `urn:lla:llaPartnerConversion:${conversionId}`,
    conversionHappenedAt: payload.eventTime.getTime(),
    user: { userIds: [{ idType: 'SHA256_EMAIL', idValue: sha256(payload.email) }] },
    conversionValue: payload.value
      ? { currencyCode: payload.currency ?? 'USD', amount: String(payload.value) }
      : undefined,
  }

  const res = await fetch('https://api.linkedin.com/rest/conversionEvents', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.access_token}`,
      'LinkedIn-Version': '202501',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LinkedIn Conversions API request failed (${res.status}): ${text}`)
  }
}

const REDDIT_EVENT_TYPE: Record<SignalEventType, string> = {
  Purchase: 'Purchase',
  Lead: 'Lead',
  ViewContent: 'ViewContent',
  AddToCart: 'AddToCart',
  InitiateCheckout: 'Custom',
}

async function sendRedditConversion(config: RedditConversionConfig, payload: SignalPayload): Promise<void> {
  const body = {
    test_mode: false,
    events: [
      {
        event_at: payload.eventTime.toISOString(),
        event_type: { tracking_type: REDDIT_EVENT_TYPE[payload.eventType] },
        event_metadata: {
          currency: payload.currency ?? 'USD',
          value_decimal: payload.value ?? undefined,
        },
        user: {
          email: payload.email ? sha256(payload.email) : undefined,
          ip_address: payload.ip ?? undefined,
          user_agent: payload.userAgent ?? undefined,
        },
      },
    ],
  }

  const res = await fetch(`https://ads-api.reddit.com/api/v2.0/conversions/events/${config.account_id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.access_token}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Reddit Conversions API request failed (${res.status}): ${text}`)
  }
}

// Reuses the existing bing_ads integration (Step 5/11's cost-sync credentials) —
// no new integration route, unlike every other platform above. Gated the same way
// Google Enhanced Conversions is: Purchase/Lead only, needs the platform's own click
// id. ConversionName here is a static "Purchase"/"Lead" string — Bing's UET offline
// import matches against a goal name pre-configured in the account's own UET setup,
// so in practice this needs that goal named to match; not configurable per-client in
// this pass (same "unverified against a live account" disclosure as the cost-sync side).
async function sendBingOfflineConversion(config: BingAdsClientConfig, payload: SignalPayload): Promise<void> {
  if (!payload.msclkid) return

  const token = await getBingAccessToken(config.refresh_token)
  const headers = bingAuthHeaders(token, config)

  const body = {
    OfflineConversions: [
      {
        MicrosoftClickId: payload.msclkid,
        ConversionName: payload.eventType,
        ConversionTime: payload.eventTime.toISOString(),
        ConversionCurrencyCode: payload.currency ?? 'USD',
        ConversionValue: payload.value ?? undefined,
      },
    ],
  }

  const res = await fetch('https://campaign.api.bingads.microsoft.com/CampaignManagement/v13/OfflineConversions/Apply', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Bing offline conversion import failed (${res.status}): ${text}`)
  }
}

// Fires the given event to every ad-platform integration the client has configured.
// Never throws — a failed/missing integration must never block the purchase, lead, or
// event flow that triggered it, same philosophy as jobs/adCosts/run.ts's per-client
// try/catch.
export async function sendConversionSignals(clientId: string, payload: SignalPayload): Promise<void> {
  const { rows } = await db.query<{ platform: string; config: Record<string, string> }>(
    `SELECT platform, config FROM client_integrations
     WHERE client_id = $1 AND platform IN (
       'facebook_capi', 'google_ads', 'tiktok_ads', 'snapchat_ads',
       'pinterest_ads', 'linkedin_ads', 'reddit_ads', 'bing_ads'
     )`,
    [clientId]
  )

  const facebookConfig = rows.find((r) => r.platform === 'facebook_capi')?.config as
    | FacebookCapiConfig
    | undefined
  const googleConfig = rows.find((r) => r.platform === 'google_ads')?.config as GoogleAdsSignalConfig | undefined
  const tiktokConfig = rows.find((r) => r.platform === 'tiktok_ads')?.config as TikTokEventsConfig | undefined
  const snapchatConfig = rows.find((r) => r.platform === 'snapchat_ads')?.config as SnapchatCapiConfig | undefined
  const pinterestConfig = rows.find((r) => r.platform === 'pinterest_ads')?.config as
    | PinterestConversionConfig
    | undefined
  const linkedinConfig = rows.find((r) => r.platform === 'linkedin_ads')?.config as
    | LinkedInConversionConfig
    | undefined
  const redditConfig = rows.find((r) => r.platform === 'reddit_ads')?.config as RedditConversionConfig | undefined
  const bingConfig = rows.find((r) => r.platform === 'bing_ads')?.config as BingAdsClientConfig | undefined

  const tasks: Promise<void>[] = []

  if (facebookConfig?.pixel_id && facebookConfig?.access_token) {
    tasks.push(
      sendFacebookCapi(facebookConfig, payload).catch((err) => {
        console.error(`[conversionSignals] Facebook CAPI failed for client=${clientId}:`, (err as Error).message)
      })
    )
  }

  if (tiktokConfig?.pixel_code && tiktokConfig?.access_token) {
    tasks.push(
      sendTikTokEvents(tiktokConfig, payload).catch((err) => {
        console.error(`[conversionSignals] TikTok Events API failed for client=${clientId}:`, (err as Error).message)
      })
    )
  }

  if (snapchatConfig?.pixel_id && snapchatConfig?.access_token) {
    tasks.push(
      sendSnapchatCapi(snapchatConfig, payload).catch((err) => {
        console.error(
          `[conversionSignals] Snapchat Conversions API failed for client=${clientId}:`,
          (err as Error).message
        )
      })
    )
  }

  if (
    googleConfig?.customer_id &&
    (payload.eventType === 'Purchase' || payload.eventType === 'Lead')
  ) {
    tasks.push(
      sendGoogleEnhancedConversion(googleConfig, payload).catch((err) => {
        console.error(
          `[conversionSignals] Google Enhanced Conversion failed for client=${clientId}:`,
          (err as Error).message
        )
      })
    )
  }

  if (pinterestConfig?.access_token && pinterestConfig?.ad_account_id) {
    tasks.push(
      sendPinterestConversion(pinterestConfig, payload).catch((err) => {
        console.error(
          `[conversionSignals] Pinterest Conversions API failed for client=${clientId}:`,
          (err as Error).message
        )
      })
    )
  }

  if (linkedinConfig?.access_token && (payload.eventType === 'Purchase' || payload.eventType === 'Lead')) {
    tasks.push(
      sendLinkedInConversion(linkedinConfig, payload).catch((err) => {
        console.error(
          `[conversionSignals] LinkedIn Conversions API failed for client=${clientId}:`,
          (err as Error).message
        )
      })
    )
  }

  if (redditConfig?.access_token && redditConfig?.account_id) {
    tasks.push(
      sendRedditConversion(redditConfig, payload).catch((err) => {
        console.error(`[conversionSignals] Reddit Conversions API failed for client=${clientId}:`, (err as Error).message)
      })
    )
  }

  if (
    bingConfig?.refresh_token &&
    payload.msclkid &&
    (payload.eventType === 'Purchase' || payload.eventType === 'Lead')
  ) {
    tasks.push(
      sendBingOfflineConversion(bingConfig, payload).catch((err) => {
        console.error(
          `[conversionSignals] Bing offline conversion import failed for client=${clientId}:`,
          (err as Error).message
        )
      })
    )
  }

  await Promise.all(tasks)
}
