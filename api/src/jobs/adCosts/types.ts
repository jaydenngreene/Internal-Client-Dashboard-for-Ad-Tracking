export interface AdCostRow {
  date: string // YYYY-MM-DD
  campaign_id: string | null
  campaign_name: string | null
  adset_id: string | null
  adset_name: string | null
  ad_id: string
  ad_name: string | null
  spend: number
  impressions: number
  clicks: number
  // The actual ad creative (what the campaign/creative drill-down UI shows) — optional
  // because only Facebook's fetcher populates it so far; every other platform's fetcher
  // leaves these undefined and upsertAdCosts writes them through as NULL.
  creative_thumbnail_url?: string | null
  creative_asset_url?: string | null
  creative_type?: 'image' | 'video' | null
  creative_headline?: string | null
  creative_primary_text?: string | null
  creative_description?: string | null
  creative_landing_page_url?: string | null
}
