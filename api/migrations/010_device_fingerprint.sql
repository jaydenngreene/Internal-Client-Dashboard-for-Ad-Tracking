-- Step 13 — device fingerprint storage. Collection only (pixel-side, see
-- pixel/src/pixel.js's getFingerprint()); server-side matching on this hash to
-- recognize a returning device without its cookie is Step 14, not this migration.
ALTER TABLE visitors
  ADD COLUMN IF NOT EXISTS fingerprint_hash TEXT,
  ADD COLUMN IF NOT EXISTS fingerprint_components JSONB;

CREATE INDEX IF NOT EXISTS idx_visitors_fingerprint
  ON visitors(client_id, fingerprint_hash) WHERE fingerprint_hash IS NOT NULL;
