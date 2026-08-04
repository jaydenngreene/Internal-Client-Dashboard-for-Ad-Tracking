-- Ad Breakdown tab (2026-08-04): purchase counts by age/gender/placement, the
-- same source Meta's own Ads Manager breakdown tables use (Insights API's
-- `actions` field combined with a single breakdowns dimension at a time).
-- Deliberately never crosses two dimensions into one matrix (age x gender x
-- placement) - each row is one dimension's value for one ad on one day, kept
-- separate from ad_costs so its existing spend/impressions/clicks queries
-- don't have to filter out a dimension they don't care about.
CREATE TABLE IF NOT EXISTS ad_breakdowns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  campaign_id TEXT,
  campaign_name TEXT,
  ad_id TEXT NOT NULL,
  ad_name TEXT,
  date DATE NOT NULL,
  breakdown_type TEXT NOT NULL, -- 'age' | 'gender' | 'placement'
  breakdown_value TEXT NOT NULL,
  purchases INTEGER NOT NULL DEFAULT 0,
  UNIQUE(client_id, platform, ad_id, date, breakdown_type, breakdown_value)
);

CREATE INDEX IF NOT EXISTS idx_ad_breakdowns_client_date ON ad_breakdowns(client_id, date, breakdown_type);
