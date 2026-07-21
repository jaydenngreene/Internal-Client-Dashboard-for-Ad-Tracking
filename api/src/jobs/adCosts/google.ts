import { GoogleAdsApi } from 'google-ads-api'
import { AdCostRow } from './types'

export interface GoogleAdsClientConfig {
  customer_id: string
  // Optional per-client overrides — defaults to the shared agency MCC credentials in .env.
  login_customer_id?: string
  refresh_token?: string
}

function getApiClient(): GoogleAdsApi {
  const client_id = process.env.GOOGLE_ADS_CLIENT_ID
  const client_secret = process.env.GOOGLE_ADS_CLIENT_SECRET
  const developer_token = process.env.GOOGLE_ADS_DEVELOPER_TOKEN
  if (!client_id || !client_secret || !developer_token) {
    throw new Error('GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_DEVELOPER_TOKEN must be set')
  }
  return new GoogleAdsApi({ client_id, client_secret, developer_token })
}

interface GoogleAdGroupAdReportRow {
  campaign: { id: string; name: string }
  ad_group: { id: string; name: string }
  ad_group_ad: { ad: { id: string; name: string | null } }
  metrics: { cost_micros: number; clicks: number; impressions: number }
  segments: { date: string }
}

// Pulls ad-level spend/impressions/clicks for [since, until] (inclusive), one row per ad per day.
export async function fetchGoogleAdCosts(
  config: GoogleAdsClientConfig,
  since: string,
  until: string
): Promise<AdCostRow[]> {
  const apiClient = getApiClient()
  const refreshToken = config.refresh_token ?? process.env.GOOGLE_ADS_REFRESH_TOKEN
  const loginCustomerId = config.login_customer_id ?? process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
  if (!refreshToken) throw new Error('No Google Ads refresh token configured (client or GOOGLE_ADS_REFRESH_TOKEN)')

  const customer = apiClient.Customer({
    customer_id: config.customer_id,
    login_customer_id: loginCustomerId,
    refresh_token: refreshToken,
  })

  const results = (await customer.report({
    entity: 'ad_group_ad',
    attributes: [
      'campaign.id',
      'campaign.name',
      'ad_group.id',
      'ad_group.name',
      'ad_group_ad.ad.id',
      'ad_group_ad.ad.name',
    ],
    metrics: ['metrics.cost_micros', 'metrics.clicks', 'metrics.impressions'],
    segments: ['segments.date'],
    from_date: since,
    to_date: until,
  })) as unknown as GoogleAdGroupAdReportRow[]

  return results.map((r) => ({
    date: r.segments.date,
    campaign_id: r.campaign?.id ?? null,
    campaign_name: r.campaign?.name ?? null,
    adset_id: r.ad_group?.id ?? null,
    adset_name: r.ad_group?.name ?? null,
    ad_id: r.ad_group_ad.ad.id,
    ad_name: r.ad_group_ad.ad.name ?? null,
    spend: (r.metrics.cost_micros ?? 0) / 1_000_000,
    impressions: r.metrics.impressions ?? 0,
    clicks: r.metrics.clicks ?? 0,
  }))
}
