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

  return rows
}
