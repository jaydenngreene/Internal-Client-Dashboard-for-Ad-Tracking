-- Step 53 — true geo-lift/holdout testing, now buildable with migration 043's
-- session-level country/region data. Same "this app doesn't execute the pause
-- itself" boundary as Step 45's time-based pause test: the user excludes the
-- holdout_regions from the campaign's own targeting in their ad platform; this
-- app only defines the test and runs the difference-in-differences analysis.
CREATE TABLE IF NOT EXISTS geo_lift_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  campaign_name TEXT NOT NULL,
  holdout_regions TEXT[] NOT NULL,
  pre_period_days INTEGER NOT NULL DEFAULT 30,
  test_start DATE NOT NULL,
  test_end DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (test_end >= test_start)
);

CREATE INDEX IF NOT EXISTS idx_geo_lift_tests_client ON geo_lift_tests(client_id);
