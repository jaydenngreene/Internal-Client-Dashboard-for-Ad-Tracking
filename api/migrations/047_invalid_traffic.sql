-- Step 56 — click fraud / invalid-traffic detection. Zero bot/invalid-traffic
-- filtering existed anywhere in this app before this — every session's UTM/click
-- data flowed straight into attribution and funnel metrics regardless of whether
-- it came from a real person. Flags rather than silently excludes: this app's
-- ad_costs (spend/clicks/impressions) come from each ad platform's own reported
-- numbers, not this pixel, so invalid traffic here mainly corrupts funnel/
-- engagement metrics (sessions, pageviews, MOF), not ad spend efficiency —
-- disclosed honestly rather than pretending this "fixes" ROAS.
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS is_suspected_bot BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bot_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_suspected_bot ON sessions(client_id, is_suspected_bot) WHERE is_suspected_bot;
