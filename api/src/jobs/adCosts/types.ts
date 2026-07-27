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
  // Video engagement (Step 42) — same Facebook-only-for-now disclosure as the
  // creative asset/copy fields above. Null for image creatives and for every
  // platform whose fetcher doesn't populate these yet.
  video_plays?: number | null
  video_p25_watched?: number | null
  video_p50_watched?: number | null
  video_p75_watched?: number | null
  video_p100_watched?: number | null
  // Impressions/reach, as Meta's Insights API reports it directly (Phase 1
  // creative-fatigue guardrails, 2026-07-27) — same Facebook-only-for-now
  // disclosure as the fields above.
  frequency?: number | null
}
