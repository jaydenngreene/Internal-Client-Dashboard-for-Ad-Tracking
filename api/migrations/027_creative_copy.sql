-- The creative detail page shows the actual ad asset (image/video, migration 024) but
-- not the ad copy that ran alongside it — headline, primary text, description, and
-- the landing page URL the ad actually points to. Same "only Facebook's fetcher
-- populates this so far" disclosure as the asset columns.
ALTER TABLE ad_costs
  ADD COLUMN IF NOT EXISTS creative_headline TEXT,
  ADD COLUMN IF NOT EXISTS creative_primary_text TEXT,
  ADD COLUMN IF NOT EXISTS creative_description TEXT,
  ADD COLUMN IF NOT EXISTS creative_landing_page_url TEXT;
