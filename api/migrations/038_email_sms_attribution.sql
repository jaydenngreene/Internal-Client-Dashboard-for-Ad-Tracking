-- Step 46 — Email/SMS marketing attribution via Klaviyo. Klaviyo's own campaign
-- reporting (opens/clicks/revenue per campaign) was never pulled into this app —
-- the existing 'klaviyo' integration (Step 12) only ever adds a person to a list,
-- it has no visibility into campaign performance. One row per campaign per day.
CREATE TABLE IF NOT EXISTS email_campaign_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  date DATE NOT NULL,
  recipients INTEGER NOT NULL DEFAULT 0,
  opens INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  revenue NUMERIC(10, 2) NOT NULL DEFAULT 0,
  orders INTEGER NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, campaign_id, date)
);

CREATE INDEX IF NOT EXISTS idx_email_campaign_stats_client_date ON email_campaign_stats(client_id, date);
