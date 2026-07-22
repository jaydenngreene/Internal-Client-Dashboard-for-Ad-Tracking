-- Step 58 — the public share link (Step 40) always showed this app's own
-- "Ad Tracking" logo/name; this lets an agency put their own logo + accent
-- color on it instead. No file-upload/blob storage exists in this app (every
-- other "give us an asset" case — Shopify theme snippets, extension icon —
-- is either code the agency hosts themselves or a static bundled file), so
-- brand_logo_url is a URL the agency hosts, same pattern as every other
-- "paste a URL" field in this app.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS brand_logo_url TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS brand_accent_color TEXT
  CHECK (brand_accent_color IS NULL OR brand_accent_color ~ '^#[0-9a-fA-F]{6}$');
