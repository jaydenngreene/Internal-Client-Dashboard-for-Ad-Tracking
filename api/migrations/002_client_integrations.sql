-- Stores platform-specific config per client (Shopify secret, Stripe key, etc.)
CREATE TABLE IF NOT EXISTS client_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_client_integrations_client ON client_integrations(client_id);
