import { AdCostRow } from './types'

// Unverified against a live account — same disclosure as tiktok.ts/snapchat.ts/
// pinterest.ts. LinkedIn's Ad Analytics API is RestLI-query-param based (URN-encoded
// lists) rather than a simple REST body, pivoted at the creative (ad) level here.
interface LinkedInAnalyticsElement {
  pivotValues: string[] // e.g. ["urn:li:sponsoredCreative:12345"]
  dateRange: { start: { year: number; month: number; day: number } }
  impressions?: number
  clicks?: number
  costInLocalCurrency?: string
}

interface LinkedInAnalyticsResponse {
  elements: LinkedInAnalyticsElement[]
}

function extractId(urn: string): string {
  const parts = urn.split(':')
  return parts[parts.length - 1]
}

interface LinkedInCopy {
  headline: string | null
  primaryText: string | null
  description: string | null
  landingPageUrl: string | null
}

const EMPTY_COPY: LinkedInCopy = { headline: null, primaryText: null, description: null, landingPageUrl: null }

// LinkedIn's Creative object's content shape depends entirely on ad format — a
// "Text Ad" carries its copy directly on the creative as
// com.linkedin.ads.TextAdCreativeVariables (headline/description/landingPage,
// handled here); a "Sponsored Content" creative instead references a UGC post via
// `content.reference`, whose commentary text would need a further /rest/posts
// lookup not implemented here (left as an explicit, disclosed gap rather than
// guessing at that second shape too). Sequential per unique ad id, same trade-off
// as facebook.ts/snapchat.ts — no documented bulk-by-ids fetch for creatives.
async function fetchLinkedInCopy(accessToken: string, adId: string): Promise<LinkedInCopy> {
  const res = await fetch(`https://api.linkedin.com/rest/creatives/urn:li:sponsoredCreative:${adId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'LinkedIn-Version': '202501',
      'X-Restli-Protocol-Version': '2.0.0',
    },
  })
  if (!res.ok) return EMPTY_COPY
  const body = (await res.json()) as {
    variables?: {
      data?: {
        'com.linkedin.ads.TextAdCreativeVariables'?: { headline?: string; description?: string; landingPage?: string }
      }
    }
  }
  const textAd = body.variables?.data?.['com.linkedin.ads.TextAdCreativeVariables']
  if (!textAd) return EMPTY_COPY
  return {
    headline: textAd.headline ?? null,
    primaryText: null,
    description: textAd.description ?? null,
    landingPageUrl: textAd.landingPage ?? null,
  }
}

export async function fetchLinkedInAdCosts(
  accessToken: string,
  accountId: string,
  since: string,
  until: string
): Promise<AdCostRow[]> {
  const [sy, sm, sd] = since.split('-').map(Number)
  const [ey, em, ed] = until.split('-').map(Number)

  const params = new URLSearchParams({
    q: 'analytics',
    pivot: 'CREATIVE',
    'dateRange.start.day': String(sd),
    'dateRange.start.month': String(sm),
    'dateRange.start.year': String(sy),
    'dateRange.end.day': String(ed),
    'dateRange.end.month': String(em),
    'dateRange.end.year': String(ey),
    timeGranularity: 'DAILY',
    accounts: `List(urn:li:sponsoredAccount:${accountId})`,
    fields: 'impressions,clicks,costInLocalCurrency,dateRange,pivotValues',
  })

  const res = await fetch(`https://api.linkedin.com/rest/adAnalytics?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'LinkedIn-Version': '202501',
      'X-Restli-Protocol-Version': '2.0.0',
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LinkedIn ad analytics request failed (${res.status}): ${text}`)
  }

  const body = (await res.json()) as LinkedInAnalyticsResponse
  const rows: AdCostRow[] = []

  for (const el of body.elements ?? []) {
    const { year, month, day } = el.dateRange.start
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const adId = extractId(el.pivotValues[0] ?? '')
    rows.push({
      date,
      campaign_id: null,
      campaign_name: null,
      adset_id: null,
      adset_name: null,
      ad_id: adId,
      ad_name: null,
      spend: parseFloat(el.costInLocalCurrency ?? '0'),
      impressions: el.impressions ?? 0,
      clicks: el.clicks ?? 0,
    })
  }

  const uniqueAdIds = Array.from(new Set(rows.map((r) => r.ad_id)))
  const copyByAdId = new Map<string, LinkedInCopy>()
  for (const adId of uniqueAdIds) {
    try {
      copyByAdId.set(adId, await fetchLinkedInCopy(accessToken, adId))
    } catch {
      copyByAdId.set(adId, EMPTY_COPY)
    }
  }
  for (const row of rows) {
    const copy = copyByAdId.get(row.ad_id) ?? EMPTY_COPY
    row.creative_headline = copy.headline
    row.creative_primary_text = copy.primaryText
    row.creative_description = copy.description
    row.creative_landing_page_url = copy.landingPageUrl
  }

  return rows
}
