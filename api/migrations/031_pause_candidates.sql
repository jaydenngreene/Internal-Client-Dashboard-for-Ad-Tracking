-- Step 35 — auto-pause, confirm-first by explicit user decision: an anomaly at the
-- ad level creates a candidate here for a human to review, never pauses anything
-- by itself. A partial unique index keeps the same underperforming ad from
-- generating a new pending row every single day the anomaly job runs.
CREATE TABLE IF NOT EXISTS pause_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  ad_id TEXT NOT NULL,
  ad_name TEXT,
  campaign_name TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'dismissed', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pause_candidates_pending_unique
  ON pause_candidates (client_id, platform, ad_id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pause_candidates_client_status ON pause_candidates(client_id, status);
