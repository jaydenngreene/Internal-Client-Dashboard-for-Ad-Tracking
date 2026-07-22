-- Step 50 — confirm-first budget reallocation (user explicitly chose confirm-
-- first, same reasoning as Step 35's pause candidates: a bad signal shouldn't be
-- able to move a real client's live ad spend unattended). Suggests shifting
-- budget from an underperforming campaign to an outperforming one within the
-- same platform; nothing here ever moves money until a human confirms.
CREATE TABLE IF NOT EXISTS budget_reallocation_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  from_campaign_id TEXT NOT NULL,
  from_campaign_name TEXT,
  from_roas NUMERIC(10, 4),
  to_campaign_id TEXT NOT NULL,
  to_campaign_name TEXT,
  to_roas NUMERIC(10, 4),
  suggested_shift_amount NUMERIC(10, 2) NOT NULL,
  reasoning TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'dismissed', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_realloc_pending_unique
  ON budget_reallocation_suggestions (client_id, platform, from_campaign_id, to_campaign_id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_budget_realloc_client_status ON budget_reallocation_suggestions(client_id, status);
