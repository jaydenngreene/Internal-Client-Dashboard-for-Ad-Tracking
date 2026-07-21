import { AdCostRow } from './types'

// Unverified against a live account — same disclosure as tiktok.ts/bing.ts.
// Snapchat's stats endpoint returns spend/impressions/swipes (their name for
// clicks) per ad id but not campaign/adsquad names — those come from a separate
// catalog call. Kept minimal (ad id only, names null) rather than adding a second
// API round-trip whose exact shape can't be verified without a live account.
interface SnapchatStatsEntry {
  id: string
  granularity: string
  timeseries: {
    start_time: string
    stats: { spend?: number; impressions?: number; swipes?: number }
  }[]
}

interface SnapchatStatsResponse {
  request_status: string
  timeseries_stats?: { timeseries_stat: SnapchatStatsEntry }[]
}

export async function fetchSnapchatAdCosts(
  accessToken: string,
  adAccountId: string,
  since: string,
  until: string
): Promise<AdCostRow[]> {
  const rows: AdCostRow[] = []

  const params = new URLSearchParams({
    granularity: 'DAY',
    start_time: `${since}T00:00:00.000-00:00`,
    end_time: `${until}T23:59:59.999-00:00`,
    fields: 'spend,impressions,swipes',
    breakdown: 'ad',
  })

  const res = await fetch(`https://adsapi.snapchat.com/v1/adaccounts/${adAccountId}/stats?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Auth/permission failures can come back as plain text rather than JSON — check
  // res.ok before parsing so that case gets a clean error instead of a JSON-parse crash.
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Snapchat stats request failed (${res.status}): ${text}`)
  }

  const body = (await res.json()) as SnapchatStatsResponse
  if (body.request_status !== 'SUCCESS') {
    throw new Error(`Snapchat stats request failed: ${body.request_status}`)
  }

  for (const entry of body.timeseries_stats ?? []) {
    const adId = entry.timeseries_stat.id
    for (const point of entry.timeseries_stat.timeseries) {
      rows.push({
        date: point.start_time.slice(0, 10),
        campaign_id: null,
        campaign_name: null,
        adset_id: null,
        adset_name: null,
        ad_id: adId,
        ad_name: null,
        // Snapchat reports spend in micros (1,000,000ths of the account currency).
        spend: (point.stats.spend ?? 0) / 1_000_000,
        impressions: point.stats.impressions ?? 0,
        clicks: point.stats.swipes ?? 0,
      })
    }
  }

  return rows
}
