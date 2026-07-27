-- Phase 1 recommendation guardrails: a shared "has this entity earned a verdict
-- yet" gate used by both Gojo (LLM insights, api/src/lib/insightsAgent.ts) and
-- Kado's native creative fatigue detector (api/src/jobs/creativeFatigue/run.ts).
-- The gate itself is computed on the fly (days-live via MIN(ad_costs.date), spend
-- via SUM(ad_costs.spend)) - the only thing that needs its own table is each
-- client's own trailing-30-day cost-per-purchase, since that's an expensive
-- account-wide aggregate we don't want recomputed inline for every single
-- creative/campaign gate check. Recomputed daily by jobs/costPerPurchase/run.ts,
-- never edited by hand (explicit product requirement: this must self-tailor to
-- the client's real economics, not become a manually-tunable field).
CREATE TABLE IF NOT EXISTS client_cost_per_purchase (
  client_id UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  cost_per_purchase NUMERIC(10, 2) NOT NULL,
  conversion_event TEXT NOT NULL, -- 'purchase' | 'subscription_conversion' | 'qualified_call' | 'lead' | 'fallback'
  conversion_count INTEGER NOT NULL,
  spend NUMERIC(12, 2) NOT NULL,
  is_fallback BOOLEAN NOT NULL DEFAULT FALSE,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Gate + multi-metric context on every flagged fatigue signal, so the UI can
-- show "why" per Phase 1's output-rules requirement (days live, confidence,
-- the actual numbers that triggered it) instead of just a CTR decline percent.
ALTER TABLE creative_fatigue_signals
  ADD COLUMN IF NOT EXISTS days_live INTEGER,
  ADD COLUMN IF NOT EXISTS confidence TEXT CHECK (confidence IN ('low', 'medium', 'high')),
  ADD COLUMN IF NOT EXISTS gate_opened_by TEXT CHECK (gate_opened_by IN ('days_live', 'spend')),
  ADD COLUMN IF NOT EXISTS cost_per_purchase_basis NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS spend_threshold NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS spend NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS metrics_triggered JSONB;

-- Meta's Insights API reports frequency (impressions/reach) directly per ad per
-- day when requested - not previously pulled since nothing consumed it. Only
-- Facebook populates this for now (Google/TikTok/etc ad-cost jobs leave it
-- null); fatigue detection treats a null frequency as "no signal," not zero.
ALTER TABLE ad_costs ADD COLUMN IF NOT EXISTS frequency NUMERIC(6, 3);
