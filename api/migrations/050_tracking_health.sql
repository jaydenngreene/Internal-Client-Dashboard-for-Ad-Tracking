-- Tracking/pixel health auditing — distinct from anomaly detection (migration
-- 032's job watches spend/ROAS moving; this watches whether the DATA PIPELINE
-- ITSELF is intact). An agency running many clients' pixels unattended has no
-- other way to notice a client's tracking silently went dark weeks before anyone
-- would otherwise catch it in a quarterly review.
CREATE TABLE IF NOT EXISTS tracking_health_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL CHECK (signal_type IN ('pixel_silent', 'traffic_drop', 'platform_orphaned_spend')),
  platform TEXT,
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('warning', 'critical')),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- COALESCE(platform,'') so platform-less signal types (pixel_silent, traffic_drop)
-- still get exactly one active row per client, while platform_orphaned_spend gets
-- one per affected platform.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tracking_health_active_unique
  ON tracking_health_signals (client_id, signal_type, COALESCE(platform, '')) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_tracking_health_client_status ON tracking_health_signals(client_id, status);
