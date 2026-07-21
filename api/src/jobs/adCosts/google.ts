import { AdCostRow } from './types'
import { GoogleAdsClientConfig, getGoogleAdsCustomer } from '../../lib/googleAdsClient'

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
  const customer = getGoogleAdsCustomer(config)

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
