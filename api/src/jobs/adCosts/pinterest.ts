import { AdCostRow } from './types'

// Unverified against a live account — same disclosure as tiktok.ts/snapchat.ts.
// Pinterest's v5 analytics endpoint returns campaign/ad-group ids alongside ad-level
// stats when level=AD, but not human-readable names in the same call — same
// names-need-a-second-call trade-off as snapchat.ts, kept minimal here too.
interface PinterestAnalyticsRow {
  AD_ID: string
  CAMPAIGN_ID?: string
  AD_GROUP_ID?: string
  SPEND_IN_DOLLAR?: number
  IMPRESSION_2?: number
  CLICKTHROUGH_2?: number
}

interface PinterestAdEntity {
  id: string
  destination_url?: string
}

// Pinterest ads are Promoted Pins — the actual visible headline/description text
// lives on the underlying Pin, not the Ad entity itself, and reaching it needs a
// further ad -> pin_id -> pin hop whose exact field name isn't confidently documented
// enough to guess at here (unlike destination_url, which is a plain field on the Ad
// object itself). headline/primaryText/description stay null; landingPageUrl is
// fetched per unique ad id, same sequential per-ad trade-off as facebook.ts/
// snapchat.ts (no documented bulk-by-ids endpoint for this call).
async function fetchPinterestLandingPageUrl(accessToken: string, adAccountId: string, adId: string): Promise<string | null> {
  const res = await fetch(`https://api.pinterest.com/v5/ad_accounts/${adAccountId}/ads/${adId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return null
  const body = (await res.json()) as PinterestAdEntity
  return body.destination_url ?? null
}

export async function fetchPinterestAdCosts(
  accessToken: string,
  adAccountId: string,
  since: string,
  until: string
): Promise<AdCostRow[]> {
  const rows: AdCostRow[] = []

  const params = new URLSearchParams({
    start_date: since,
    end_date: until,
    granularity: 'DAY',
    level: 'AD',
    columns: 'SPEND_IN_DOLLAR,IMPRESSION_2,CLICKTHROUGH_2,CAMPAIGN_ID,AD_GROUP_ID',
  })

  const res = await fetch(`https://api.pinterest.com/v5/ad_accounts/${adAccountId}/analytics?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Pinterest analytics request failed (${res.status}): ${text}`)
  }

  // Pinterest returns { "<date>": [ { AD_ID, ... } ] } keyed by day when
  // granularity=DAY — iterate the date keys rather than a flat array.
  const body = (await res.json()) as Record<string, PinterestAnalyticsRow[]>

  for (const [date, entries] of Object.entries(body)) {
    for (const r of entries) {
      rows.push({
        date,
        campaign_id: r.CAMPAIGN_ID ?? null,
        campaign_name: null,
        adset_id: r.AD_GROUP_ID ?? null,
        adset_name: null,
        ad_id: r.AD_ID,
        ad_name: null,
        spend: r.SPEND_IN_DOLLAR ?? 0,
        impressions: r.IMPRESSION_2 ?? 0,
        clicks: r.CLICKTHROUGH_2 ?? 0,
      })
    }
  }

  const uniqueAdIds = Array.from(new Set(rows.map((r) => r.ad_id)))
  const landingPageByAdId = new Map<string, string | null>()
  for (const adId of uniqueAdIds) {
    try {
      landingPageByAdId.set(adId, await fetchPinterestLandingPageUrl(accessToken, adAccountId, adId))
    } catch {
      landingPageByAdId.set(adId, null)
    }
  }
  for (const row of rows) {
    row.creative_headline = null
    row.creative_primary_text = null
    row.creative_description = null
    row.creative_landing_page_url = landingPageByAdId.get(row.ad_id) ?? null
  }

  return rows
}
