-- Real file-upload support (2026-07-25) — every "give us an asset" case until
-- now (Step 58's brand_logo_url, Shopify theme snippets, etc.) was a URL the
-- agency hosts themselves; no actual blob storage existed anywhere in this
-- app. Small branding images (agency/client logos) don't need a dedicated
-- object-storage service — stored as bytea in the same Postgres database
-- everything else already lives in, served back out through a dedicated
-- route (GET /uploads/:id). Not a general file-storage system: scoped to
-- small images uploaded through the branding upload endpoint specifically.
CREATE TABLE IF NOT EXISTS uploaded_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type TEXT NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS agency_logo_url TEXT;
