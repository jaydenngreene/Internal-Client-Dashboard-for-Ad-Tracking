import { AdCostRow } from './types'
import { GoogleAdsClientConfig, getGoogleAdsCustomer } from '../../lib/googleAdsClient'

interface GoogleAdGroupAdReportRow {
  campaign: { id: string; name: string }
  ad_group: { id: string; name: string }
  ad_group_ad: {
    ad: {
      id: string
      name: string | null
      final_urls?: string[]
      responsive_search_ad?: { headlines?: { text: string }[]; descriptions?: { text: string }[] }
      expanded_text_ad?: {
        headline_part1?: string
        headline_part2?: string
        headline_part3?: string
        description?: string
        description2?: string
      }
    }
  }
  metrics: { cost_micros: number; clicks: number; impressions: number }
  segments: { date: string }
}

// Google Search ads have no field distinct from headline/description the way
// Facebook's "primary text" is (headline + description IS the whole ad) — primaryText
// is always null here. Responsive Search Ads (most accounts today) carry multiple
// headline/description variants; the first of each is used as "the" headline/
// description rather than trying to represent every combination the auto-optimizer
// might serve. Falls back to the older Expanded Text Ad fields for accounts still
// running that legacy format.
function deriveGoogleCopy(ad: GoogleAdGroupAdReportRow['ad_group_ad']['ad']): {
  headline: string | null
  primaryText: string | null
  description: string | null
  landingPageUrl: string | null
} {
  const rsa = ad.responsive_search_ad
  const eta = ad.expanded_text_ad
  const headline =
    rsa?.headlines?.[0]?.text ??
    [eta?.headline_part1, eta?.headline_part2, eta?.headline_part3].filter(Boolean).join(' - ') ??
    null
  const description =
    rsa?.descriptions?.map((d) => d.text).join(' ') ??
    [eta?.description, eta?.description2].filter(Boolean).join(' ') ??
    null
  return {
    headline: headline || null,
    primaryText: null,
    description: description || null,
    landingPageUrl: ad.final_urls?.[0] ?? null,
  }
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
      'ad_group_ad.ad.final_urls',
      'ad_group_ad.ad.responsive_search_ad.headlines',
      'ad_group_ad.ad.responsive_search_ad.descriptions',
      'ad_group_ad.ad.expanded_text_ad.headline_part1',
      'ad_group_ad.ad.expanded_text_ad.headline_part2',
      'ad_group_ad.ad.expanded_text_ad.headline_part3',
      'ad_group_ad.ad.expanded_text_ad.description',
      'ad_group_ad.ad.expanded_text_ad.description2',
    ],
    metrics: ['metrics.cost_micros', 'metrics.clicks', 'metrics.impressions'],
    segments: ['segments.date'],
    from_date: since,
    to_date: until,
  })) as unknown as GoogleAdGroupAdReportRow[]

  return results.map((r) => {
    const copy = deriveGoogleCopy(r.ad_group_ad.ad)
    return {
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
      creative_headline: copy.headline,
      creative_primary_text: copy.primaryText,
      creative_description: copy.description,
      creative_landing_page_url: copy.landingPageUrl,
    }
  })
}
