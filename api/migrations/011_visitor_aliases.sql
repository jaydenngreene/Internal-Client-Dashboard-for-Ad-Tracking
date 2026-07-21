-- Step 14 — maps an anonymous_id that was never given its own `visitors` row
-- (because it fingerprint-matched an existing visitor instead) back to that
-- visitor's canonical id, so repeat pageviews from the same cleared-cookie browser
-- keep resolving to the same visitor without creating a new one each time.
CREATE TABLE IF NOT EXISTS visitor_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  anonymous_id TEXT NOT NULL,
  canonical_visitor_id UUID NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  matched_via TEXT NOT NULL DEFAULT 'fingerprint',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, anonymous_id)
);

CREATE INDEX IF NOT EXISTS idx_visitor_aliases_canonical ON visitor_aliases(canonical_visitor_id);
