-- Step 29 — Outbound webhooks / event subscriptions. Every other webhook in this
-- app is inbound (external platforms notifying us); this is the reverse — letting a
-- client's own systems subscribe to internal events (sale.attributed, lead.opted.in,
-- call.qualified). A client can want multiple target URLs with different event
-- filters, a genuine one-to-many shape client_integrations (one row per client+
-- platform) doesn't fit — a dedicated table is the right call here, not
-- upsertIntegration(). outbound_webhook_deliveries is a delivery LOG for debugging,
-- not a durable retry queue — a failed delivery is logged and dropped, matching this
-- app's existing scale and its never-block-the-core-write-path philosophy.
CREATE TABLE IF NOT EXISTS outbound_webhook_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  target_url TEXT NOT NULL,
  event_types TEXT[] NOT NULL,
  signing_secret TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS outbound_webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES outbound_webhook_subscriptions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  response_status INTEGER,
  error TEXT,
  attempted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbound_webhook_subs_client ON outbound_webhook_subscriptions(client_id);
CREATE INDEX IF NOT EXISTS idx_outbound_webhook_deliveries_sub ON outbound_webhook_deliveries(subscription_id, attempted_at);
