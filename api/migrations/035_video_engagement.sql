-- Step 42 — video engagement metrics (hook rate, quartile view-through), Facebook
-- only for now, same disclosure pattern as the creative asset/copy columns
-- (migrations 024/027). Nullable — image creatives and every other platform's
-- fetcher leave these NULL.
ALTER TABLE ad_costs
  ADD COLUMN IF NOT EXISTS video_plays INTEGER,
  ADD COLUMN IF NOT EXISTS video_p25_watched INTEGER,
  ADD COLUMN IF NOT EXISTS video_p50_watched INTEGER,
  ADD COLUMN IF NOT EXISTS video_p75_watched INTEGER,
  ADD COLUMN IF NOT EXISTS video_p100_watched INTEGER;
