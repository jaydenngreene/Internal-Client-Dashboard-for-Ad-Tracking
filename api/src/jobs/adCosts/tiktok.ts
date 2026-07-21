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

  return rows
}
