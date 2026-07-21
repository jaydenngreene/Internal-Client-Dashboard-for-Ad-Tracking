-- Step 24 — Tags & Stages. Mirrors Hyros's own tag-as-event-bus mechanism: a
-- freeform label system that doubles as funnel-stage tracking (tag_type='funnel_stage',
-- stage_order for sequencing) and, for 'product' tags, an auto-sale trigger — applying
-- a product tag to a lead generates a Sale via the existing recordPurchase() pipeline
-- (Step 25), reusing all attribution/LTV/conversion-signal wiring rather than a
-- second parallel path.
CREATE TABLE IF NOT EXISTS tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  tag_type TEXT NOT NULL DEFAULT 'freeform' CHECK (tag_type IN ('freeform', 'funnel_stage', 'product')),
  stage_order INTEGER,
  product_value NUMERIC(10, 2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, name)
);

CREATE TABLE IF NOT EXISTS lead_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  applied_by TEXT NOT NULL DEFAULT 'manual',
  UNIQUE(client_id, email, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_tags_client_email ON lead_tags(client_id, email);
CREATE INDEX IF NOT EXISTS idx_lead_tags_tag ON lead_tags(tag_id);
