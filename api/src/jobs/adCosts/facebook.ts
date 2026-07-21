import { AdCostRow } from './types'

const GRAPH_VERSION = process.env.FB_GRAPH_API_VERSION ?? 'v21.0'

interface FacebookInsightRow {
  campaign_id?: string
  campaign_name?: string
  adset_id?: string
  adset_name?: string
  ad_id: string
  ad_name?: string
  spend?: string
  impressions?: string
  clicks?: string
  date_start: string
}

interface FacebookInsightsResponse {
  data: FacebookInsightRow[]
  paging?: { cursors?: { after?: string }; next?: string }
  error?: { message: string; type: string; code: number }
}

// Pulls ad-level spend/impressions/clicks for [since, until] (inclusive), one row per ad per day.
export async function fetchFacebookAdCosts(
  accessToken: string,
  adAccountId: string,
  since: string,
  until: string
): Promise<AdCostRow[]> {
  const rows: AdCostRow[] = []
  const account = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`

  let url: string | null =
    `https://graph.facebook.com/${GRAPH_VERSION}/${account}/insights` +
    `?level=ad&time_increment=1` +
    `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
    `&fields=${encodeURIComponent(
      'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks'
    )}` +
    `&limit=500` +
    `&access_token=${encodeURIComponent(accessToken)}`

  while (url) {
    const res = await fetch(url)
    const body = (await res.json()) as FacebookInsightsResponse

    if (!res.ok || body.error) {
      throw new Error(`Facebook insights request failed: ${body.error?.message ?? res.statusText}`)
    }

    for (const r of body.data) {
      rows.push({
        date: r.date_start,
        campaign_id: r.campaign_id ?? null,
        campaign_name: r.campaign_name ?? null,
        adset_id: r.adset_id ?? null,
        adset_name: r.adset_name ?? null,
        ad_id: r.ad_id,
        ad_name: r.ad_name ?? null,
        spend: parseFloat(r.spend ?? '0'),
        impressions: parseInt(r.impressions ?? '0', 10),
        clicks: parseInt(r.clicks ?? '0', 10),
      })
    }

    url = body.paging?.next ?? null
  }

  return rows
}
