-- Client niche/business type, used to tailor which dashboard metrics are shown.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS niche TEXT NOT NULL DEFAULT 'other';

ALTER TABLE clients
  ADD CONSTRAINT clients_niche_check
  CHECK (niche IN ('ecommerce', 'call', 'lead_gen', 'saas', 'info_product', 'other'));

-- Ecommerce funnel events: product views, add-to-cart, checkout initiation.
CREATE TABLE IF NOT EXISTS cart_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('view_item', 'add_to_cart', 'begin_checkout')),
  product_id TEXT,
  product_name TEXT,
  value NUMERIC(10, 2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cart_events_client_type_date ON cart_events(client_id, event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_cart_events_session ON cart_events(session_id);
