-- Step 45 — time-based pause/holdout incrementality testing, the buildable
-- alternative to true geo-lift testing (this app captures no geographic data on
-- sessions at all, confirmed while scoping this step — geo-holdout would need
-- IP-geolocation added to the pixel pipeline first, a separate project). The user
-- manually pauses the campaign in their ad platform for [pause_start, pause_end];
-- this app only defines the test window and runs the before/after analysis —
-- it never pauses anything itself.
CREATE TABLE IF NOT EXISTS incrementality_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  campaign_name TEXT NOT NULL,
  pre_period_days INTEGER NOT NULL DEFAULT 30,
  pause_start DATE NOT NULL,
  pause_end DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (pause_end >= pause_start)
);

CREATE INDEX IF NOT EXISTS idx_incrementality_tests_client ON incrementality_tests(client_id);
