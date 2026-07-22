-- Step 47 — creative fatigue detection: a DECLINING TREND signal, distinct from
-- the ROAS-threshold pause_candidates (migration 031) which reacts to a value
-- already crossing a line. Fatigue is advisory only ("consider refreshing this
-- creative") — no confirm-and-pause action, unlike pause_candidates.
CREATE TABLE IF NOT EXISTS creative_fatigue_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  ad_id TEXT NOT NULL,
  ad_name TEXT,
  campaign_name TEXT,
  recent_ctr NUMERIC(6, 3) NOT NULL,
  prior_ctr NUMERIC(6, 3) NOT NULL,
  decline_pct NUMERIC(6, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_creative_fatigue_active_unique
  ON creative_fatigue_signals (client_id, platform, ad_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_creative_fatigue_client_status ON creative_fatigue_signals(client_id, status);
