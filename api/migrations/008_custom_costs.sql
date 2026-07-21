-- Step 26 — Custom Costs: manual ad-spend entry for platforms without a native
-- cost-sync integration (native ad networks, sponsorships, etc). A separate table
-- rather than another ad_costs row, since ad_costs' unique key is (platform, ad_id,
-- date) and manual entries have no ad_id/campaign structure to key on — just a
-- free-text label and a daily total.
CREATE TABLE IF NOT EXISTS custom_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform_label TEXT NOT NULL,
  date DATE NOT NULL,
  spend NUMERIC(10, 2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, platform_label, date)
);

CREATE INDEX IF NOT EXISTS idx_custom_costs_client_date ON custom_costs(client_id, date);
