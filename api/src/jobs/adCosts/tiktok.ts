import { AdCostRow } from './types'

// Unverified against a live account — no maintained npm wrapper for TikTok's
// Marketing API exists, hand-rolled against their documented Reporting endpoint.
// Same disclosure Facebook/Google/Bing carried before real credentials existed.
const TIKTOK_API_VERSION = 'v1.3'

interface TikTokReportRow {
  dimensions: { ad_id: string; stat_time_day: string }
  metrics: {
    spend?: string
    impressions?: string
    clicks?: string
    campaign_id?: string
    campaign_name?: string
    adgroup_id?: string
    adgroup_name?: string
    ad_name?: string
  }
}

interface TikTokReportResponse {
  code: number
  message: string
  data?: {
    list: TikTokReportRow[]
    page_info?: { page: number; total_page: number }
  }
}

interface TikTokAdEntity {
  ad_id: string
  ad_text?: string
  landing_page_url?: string
}

interface TikTokAdGetResponse {
  code: number
  message: string
  data?: { list: TikTokAdEntity[] }
}

// TikTok's basic ad formats have a single "ad_text" field (shown alongside the
// creative) rather than a distinct headline/primary-text/description split — mapped
// to primaryText since that's the closest fit, headline/description left null rather
// than guessed. Unlike Facebook's per-ad lookup, TikTok's ad/get endpoint accepts a
// list of ad_ids in one filtered call, so this is one request per 100 ads instead of
// one request per ad.
async function fetchTikTokCopy(
  accessToken: string,
  advertiserId: string,
  adIds: string[]
): Promise<Map<string, { headline: string | null; primaryText: string | null; description: string | null; landingPageUrl: string | null }>> {
  const result = new Map<
    string,
    { headline: string | null; primaryText: string | null; description: string | null; landingPageUrl: string | null }
  >()

  for (let i = 0; i < adIds.length; i += 100) {
    const chunk = adIds.slice(i, i + 100)
    const params = new URLSearchParams({
      advertiser_id: advertiserId,
      filtering: JSON.stringify({ ad_ids: chunk }),
      fields: JSON.stringify(['ad_id', 'ad_text', 'landing_page_url']),
      page_size: '100',
    })
    try {
      const res = await fetch(`https://business-api.tiktok.com/open_api/${TIKTOK_API_VERSION}/ad/get/?${params.toString()}`, {
        headers: { 'Access-Token': accessToken },
      })
      const body = (await res.json()) as TikTokAdGetResponse
      if (!res.ok || body.code !== 0) continue
      for (const ad of body.data?.list ?? []) {
        result.set(ad.ad_id, {
          headline: null,
          primaryText: ad.ad_text ?? null,
          description: null,
          landingPageUrl: ad.landing_page_url ?? null,
        })
      }
    } catch {
      // A failed copy lookup never blocks spend/impressions/clicks from syncing.
    }
  }

  return result
}

export async function fetchTikTokAdCosts(
  accessToken: string,
  advertiserId: string,
  since: string,
  until: string
): Promise<AdCostRow[]> {
  const rows: AdCostRow[] = []
  let page = 1
  let totalPages = 1

  do {
    const params = new URLSearchParams({
      advertiser_id: advertiserId,
      report_type: 'BASIC',
      data_level: 'AUCTION_AD',
      dimensions: JSON.stringify(['ad_id', 'stat_time_day']),
      metrics: JSON.stringify([
        'spend',
        'impressions',
        'clicks',
        'campaign_id',
        'campaign_name',
        'adgroup_id',
        'adgroup_name',
        'ad_name',
      ]),
      start_date: since,
      end_date: until,
      page: String(page),
      page_size: '500',
    })

    const res = await fetch(
      `https://business-api.tiktok.com/open_api/${TIKTOK_API_VERSION}/report/integrated/get/?${params.toString()}`,
      { headers: { 'Access-Token': accessToken } }
    )
    const body = (await res.json()) as TikTokReportResponse

    if (!res.ok || body.code !== 0) {
      throw new Error(`TikTok report request failed: ${body.message ?? res.statusText}`)
    }

    for (const r of body.data?.list ?? []) {
      rows.push({
        date: r.dimensions.stat_time_day.slice(0, 10),
        campaign_id: r.metrics.campaign_id ?? null,
        campaign_name: r.metrics.campaign_name ?? null,
        adset_id: r.metrics.adgroup_id ?? null,
        adset_name: r.metrics.adgroup_name ?? null,
        ad_id: r.dimensions.ad_id,
        ad_name: r.metrics.ad_name ?? null,
        spend: parseFloat(r.metrics.spend ?? '0'),
        impressions: parseInt(r.metrics.impressions ?? '0', 10),
        clicks: parseInt(r.metrics.clicks ?? '0', 10),
      })
    }

    totalPages = body.data?.page_info?.total_page ?? 1
    page += 1
  } while (page <= totalPages)

  const copyByAdId = await fetchTikTokCopy(accessToken, advertiserId, Array.from(new Set(rows.map((r) => r.ad_id))))
  for (const row of rows) {
    const copy = copyByAdId.get(row.ad_id)
    row.creative_headline = copy?.headline ?? null
    row.creative_primary_text = copy?.primaryText ?? null
    row.creative_description = copy?.description ?? null
    row.creative_landing_page_url = copy?.landingPageUrl ?? null
  }

  return rows
}
