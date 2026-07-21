-- Step 28 — Audience Sync: export a lead/customer segment as a Meta Custom
-- Audience or a Google Customer Match list, reusing the existing facebook_ads/
-- google_ads integration credentials (no new integration platform needed).
CREATE TABLE IF NOT EXISTS audience_syncs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('facebook_custom_audience', 'google_customer_match')),
  name TEXT NOT NULL,
  segment_definition JSONB NOT NULL,
  external_audience_id TEXT,
  last_synced_at TIMESTAMPTZ,
  last_sync_count INTEGER,
  last_sync_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audience_syncs_client ON audience_syncs(client_id);
