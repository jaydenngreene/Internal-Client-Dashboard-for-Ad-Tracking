-- Step 21 — Subscription entity/lifecycle for the SaaS vertical (niche='saas'),
-- which previously got nothing beyond the generic one-time-purchase LTV model.
-- subscription_events is an append-only transition log (only real status changes
-- get a row, not every webhook delivery) so MRR/churn/trial-conversion reporting
-- (Step 22) can be computed from it directly rather than re-deriving deltas at
-- query time.
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email TEXT,
  processor TEXT NOT NULL DEFAULT 'stripe',
  external_subscription_id TEXT NOT NULL,
  plan_name TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')
  ),
  mrr_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  trial_ends_at TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, processor, external_subscription_id)
);

CREATE TABLE IF NOT EXISTS subscription_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('created', 'trial_started', 'trial_converted', 'activated', 'past_due', 'canceled', 'reactivated', 'plan_changed')
  ),
  from_status TEXT,
  to_status TEXT,
  mrr_delta NUMERIC(10, 2) NOT NULL DEFAULT 0,
  occurred_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_client_status ON subscriptions(client_id, status);
CREATE INDEX IF NOT EXISTS idx_subscription_events_client_time ON subscription_events(client_id, occurred_at);
