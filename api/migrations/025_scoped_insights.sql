-- client_insights was one row per client (client_id itself was the primary key).
-- Generalizing it to also hold one row per campaign and per creative, so each
-- can have its own AI-generated insight instead of only ever a single
-- whole-account one. scope_key is the campaign or creative name (matches how
-- reports.ts's funnel breakdown already keys them); NULL for the client-level
-- scope. platform is included in the uniqueness for campaign/creative scopes
-- for the same reason the funnel breakdown composite-keys on it — a same-named
-- campaign on two platforms needs two separate insights, not one blended one.
ALTER TABLE client_insights DROP CONSTRAINT client_insights_pkey;
ALTER TABLE client_insights ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
UPDATE client_insights SET id = gen_random_uuid() WHERE id IS NULL;
ALTER TABLE client_insights ALTER COLUMN id SET NOT NULL;
ALTER TABLE client_insights ADD PRIMARY KEY (id);

ALTER TABLE client_insights
  ADD COLUMN IF NOT EXISTS scope_type TEXT NOT NULL DEFAULT 'client' CHECK (scope_type IN ('client', 'campaign', 'creative')),
  ADD COLUMN IF NOT EXISTS scope_platform TEXT,
  ADD COLUMN IF NOT EXISTS scope_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_client_insights_scope
  ON client_insights (client_id, scope_type, COALESCE(scope_platform, ''), COALESCE(scope_key, ''));
