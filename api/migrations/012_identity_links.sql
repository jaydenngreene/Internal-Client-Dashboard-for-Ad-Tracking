-- Step 15 — cross-device identity stitching. Distinct from Step 14's
-- visitor_aliases (same device, cleared cookie, matched via fingerprint): this
-- links two DIFFERENT identities.email records together when there's real evidence
-- they're the same person on two different devices — a shared phone number, a
-- shared IP, or a manual override from whoever's reviewing the data. Nothing here
-- merges rows destructively; it's an auditable link with a recorded reason,
-- mirroring Hyros's own `mechanism` enum (session_id/phone_number/ip/manual) —
-- the session_id case is deliberately NOT re-detected here since it's exactly what
-- Step 14's visitor_aliases already captures; label it that way at read time
-- instead of building a second detector for the same signal.
ALTER TABLE identities ADD COLUMN IF NOT EXISTS phone TEXT;
CREATE INDEX IF NOT EXISTS idx_identities_phone ON identities(client_id, phone) WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS identity_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  primary_identity_id UUID NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  linked_identity_id UUID NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  mechanism TEXT NOT NULL CHECK (mechanism IN ('session_id', 'phone_number', 'ip', 'manual')),
  confidence NUMERIC(3, 2) NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, primary_identity_id, linked_identity_id)
);

CREATE INDEX IF NOT EXISTS idx_identity_links_client ON identity_links(client_id);
CREATE INDEX IF NOT EXISTS idx_identity_links_linked ON identity_links(linked_identity_id);
