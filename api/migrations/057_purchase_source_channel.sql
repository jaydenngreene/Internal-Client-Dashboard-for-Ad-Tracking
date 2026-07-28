-- Diagnostic (2026-07-28): repeated identify() investigations for Nothing But
-- Buckets kept assuming the checkout pixel wasn't firing, but that was never
-- actually confirmed at the source - Shopify's order webhook already carries
-- source_name/referring_site (which sales channel the order came through:
-- "web" is the normal storefront, other values are POS/Facebook-Instagram
-- Shop/etc), and this app has never captured it. An order placed through
-- Meta's native in-app checkout would never load Shopify's storefront or
-- checkout pages at all, so no pixel - ours or Shopify's own - would ever get
-- a chance to fire, regardless of what code is pasted where.
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS source_name TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS referring_site TEXT;
