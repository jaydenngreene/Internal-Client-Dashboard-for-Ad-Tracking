-- Multi-tenant clients
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  pixel_key TEXT UNIQUE NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Anonymous visitors (pre-identity)
CREATE TABLE IF NOT EXISTS visitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  anonymous_id TEXT NOT NULL,
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  ip TEXT,
  user_agent TEXT,
  UNIQUE(client_id, anonymous_id)
);

-- Ad click sessions (one per landing, carries UTM + click IDs)
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  visitor_id UUID NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  -- Ad platform click IDs
  fbclid TEXT,
  gclid TEXT,
  ttclid TEXT,
  -- UTM params
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  -- Entry point
  landing_page TEXT,
  referrer TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW()
);

-- All pageviews
CREATE TABLE IF NOT EXISTS pageviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Identity resolution: links email to anonymous visitor
CREATE TABLE IF NOT EXISTS identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  visitor_id UUID NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  identified_at TIMESTAMPTZ DEFAULT NOW(),
  identified_on_page TEXT,
  UNIQUE(client_id, email)
);

-- TOF/MOF lead events (optin, webinar reg, call booked, etc)
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  lead_type TEXT NOT NULL DEFAULT 'optin',
  page TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- BOF purchase/conversion events
CREATE TABLE IF NOT EXISTS purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  revenue NUMERIC(10, 2) NOT NULL,
  product TEXT,
  order_id TEXT,
  processor TEXT,
  refunded BOOLEAN DEFAULT FALSE,
  refunded_at TIMESTAMPTZ,
  purchased_at TIMESTAMPTZ DEFAULT NOW()
);

-- Attribution: which session gets credit for which purchase
CREATE TABLE IF NOT EXISTS attributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  model TEXT NOT NULL DEFAULT 'first_click',
  credit_fraction NUMERIC(5, 4) NOT NULL DEFAULT 1.0,
  attributed_revenue NUMERIC(10, 2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ad cost data pulled from platform APIs
CREATE TABLE IF NOT EXISTS ad_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  campaign_id TEXT,
  campaign_name TEXT,
  adset_id TEXT,
  adset_name TEXT,
  ad_id TEXT,
  ad_name TEXT,
  date DATE NOT NULL,
  spend NUMERIC(10, 2) NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  UNIQUE(client_id, platform, ad_id, date)
);

-- Customer LTV (updated by background job)
CREATE TABLE IF NOT EXISTS customer_ltv (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  acquisition_campaign TEXT,
  acquisition_ad TEXT,
  acquisition_source TEXT,
  first_purchase_date TIMESTAMPTZ,
  revenue_30d NUMERIC(10, 2) DEFAULT 0,
  revenue_60d NUMERIC(10, 2) DEFAULT 0,
  revenue_90d NUMERIC(10, 2) DEFAULT 0,
  revenue_180d NUMERIC(10, 2) DEFAULT 0,
  revenue_lifetime NUMERIC(10, 2) DEFAULT 0,
  purchase_count INTEGER DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, email)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_visitors_client_anon ON visitors(client_id, anonymous_id);
CREATE INDEX IF NOT EXISTS idx_sessions_visitor ON sessions(visitor_id);
CREATE INDEX IF NOT EXISTS idx_sessions_fbclid ON sessions(fbclid) WHERE fbclid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_gclid ON sessions(gclid) WHERE gclid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pageviews_session ON pageviews(session_id);
CREATE INDEX IF NOT EXISTS idx_identities_email ON identities(client_id, email);
CREATE INDEX IF NOT EXISTS idx_identities_visitor ON identities(visitor_id);
CREATE INDEX IF NOT EXISTS idx_purchases_email ON purchases(client_id, email);
CREATE INDEX IF NOT EXISTS idx_ad_costs_client_date ON ad_costs(client_id, date);
CREATE INDEX IF NOT EXISTS idx_customer_ltv_email ON customer_ltv(client_id, email);
