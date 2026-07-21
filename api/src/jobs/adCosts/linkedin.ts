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

  return rows
}
