-- Lets the campaign/creative drill-down UI show the actual ad (image or video)
-- instead of just its name — populated by whichever ad-cost-sync fetcher can
-- actually pull it from that platform's API (Facebook first; other platforms
-- leave these null until their own fetchers are extended the same way, and the
-- UI shows a placeholder for those).
ALTER TABLE ad_costs
  ADD COLUMN IF NOT EXISTS creative_thumbnail_url TEXT,
  ADD COLUMN IF NOT EXISTS creative_asset_url TEXT,
  ADD COLUMN IF NOT EXISTS creative_type TEXT CHECK (creative_type IN ('image', 'video'));
