-- AI creative tagging (auto-tags a creative's hook/angle/tone/format from its ad
-- copy) plus the performance-correlation view built on top of it — the "what KIND
-- of creative wins, not just which specific ad" gap flagged against Motion/Triple
-- Whale's Creative Cockpit. Text-based (ad copy + asset type), not full
-- computer-vision image analysis of the creative asset itself — a disclosed scope
-- cut, same "simple, honest method" ethos as this app's other AI/statistical
-- features, and one that works for all 8 ad platforms (every platform's ad_costs
-- rows carry copy since the "ad copy for all 7 non-Facebook platforms" pass),
-- not just the Facebook-only asset/video-metrics depth.
--
-- Keyed on (client_id, platform, ad_name) rather than ad_id — matches the existing
-- campaignDetail.ts creative-detail route, which already treats normalized ad_name
-- as a creative's practical identity (campaigns/:platform/:campaignName/creatives/
-- :creativeName IS an ad_name), not ad_id. Keeping the same key means the
-- dashboard's creative-detail page — which only ever has platform+creativeName on
-- hand, never ad_id — can call this directly.
CREATE TABLE IF NOT EXISTS creative_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  ad_name TEXT NOT NULL,
  hook_type TEXT,
  angle TEXT,
  tone TEXT,
  format TEXT,
  model TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error TEXT,
  UNIQUE (client_id, platform, ad_name)
);

CREATE INDEX IF NOT EXISTS idx_creative_tags_client ON creative_tags(client_id);
