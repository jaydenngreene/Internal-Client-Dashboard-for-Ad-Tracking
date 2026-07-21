import { AdCostRow } from './types'

// Unverified against a live account — same disclosure as tiktok.ts/snapchat.ts/
// pinterest.ts/linkedin.ts.
interface RedditReportRow {
  ad_id: string
  date: string
  metrics: { spend?: number; impressions?: number; clicks?: number }
}

interface RedditReportResponse {
  data?: RedditReportRow[]
}

export async function fetchRedditAdCosts(
  accessToken: string,
  accountId: string,
  since: string,
  until: string
): Promise<AdCostRow[]> {
  const params = new URLSearchParams({
    starts_at: `${since}T00:00:00Z`,
    ends_at: `${until}T23:59:59Z`,
    breakdown: 'ad_id',
    'metrics.spend': 'true',
    'metrics.impressions': 'true',
    'metrics.clicks': 'true',
  })

  const res = await fetch(`https://ads-api.reddit.com/api/v2.0/ad_accounts/${accountId}/reports?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Reddit ads report request failed (${res.status}): ${text}`)
  }

  const body = (await res.json()) as RedditReportResponse
  const rows: AdCostRow[] = []

  for (const r of body.data ?? []) {
    rows.push({
      date: r.date.slice(0, 10),
      campaign_id: null,
      campaign_name: null,
      adset_id: null,
      adset_name: null,
      ad_id: r.ad_id,
      ad_name: null,
      // Reddit reports spend in hundredths of a cent (micro-currency units).
      spend: (r.metrics.spend ?? 0) / 1_000_000,
      impressions: r.metrics.impressions ?? 0,
      clicks: r.metrics.clicks ?? 0,
    })
  }

  return rows
}
