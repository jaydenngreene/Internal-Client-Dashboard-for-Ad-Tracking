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

interface SnapchatCopy {
  headline: string | null
  primaryText: string | null
  description: string | null
  landingPageUrl: string | null
}

const EMPTY_COPY: SnapchatCopy = { headline: null, primaryText: null, description: null, landingPageUrl: null }

interface SnapchatAdResponse {
  ads?: { sub_request_status: string; ad?: { id: string; creative_id?: string } }[]
}

interface SnapchatCreativeResponse {
  creatives?: {
    sub_request_status: string
    creative?: { id: string; headline?: string; web_view_properties?: { url?: string } }
  }[]
}

// Two-hop, per ad: an Ad only references a creative_id, the actual headline/
// destination live on the Creative itself. There's no documented bulk-fetch-by-ids
// for creatives the way TikTok's ad/get supports, so this is sequential like
// Facebook's — same rate-limit-conservatism trade-off. `headline` is the only field
// Snapchat's Creative object reliably carries as review-facing ad copy; there's no
// separate primary-text/description field the way Facebook has, so those stay null
// rather than mapping something else in as a guess.
async function fetchSnapchatCopy(accessToken: string, adId: string): Promise<SnapchatCopy> {
  const adRes = await fetch(`https://adsapi.snapchat.com/v1/ads/${adId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!adRes.ok) return EMPTY_COPY
  const adBody = (await adRes.json()) as SnapchatAdResponse
  const creativeId = adBody.ads?.[0]?.ad?.creative_id
  if (!creativeId) return EMPTY_COPY

  const creativeRes = await fetch(`https://adsapi.snapchat.com/v1/creatives/${creativeId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!creativeRes.ok) return EMPTY_COPY
  const creativeBody = (await creativeRes.json()) as SnapchatCreativeResponse
  const creative = creativeBody.creatives?.[0]?.creative
  if (!creative) return EMPTY_COPY

  return {
    headline: creative.headline ?? null,
    primaryText: null,
    description: null,
    landingPageUrl: creative.web_view_properties?.url ?? null,
  }
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

  const uniqueAdIds = Array.from(new Set(rows.map((r) => r.ad_id)))
  const copyByAdId = new Map<string, SnapchatCopy>()
  for (const adId of uniqueAdIds) {
    try {
      copyByAdId.set(adId, await fetchSnapchatCopy(accessToken, adId))
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
