-- Lets the dashboard show a plain "this is costing you about $X/day" outcome
-- alongside the raw ROAS-drop reason, instead of just a ratio - the same
-- outcome-framed-copy pattern Ramp uses (translate a delta into a dollar
-- consequence). Nullable since these are only ever set going forward, existing
-- pending candidates just won't show the extra line until the next detection run.
ALTER TABLE pause_candidates
  ADD COLUMN IF NOT EXISTS daily_spend NUMERIC,
  ADD COLUMN IF NOT EXISTS daily_revenue NUMERIC,
  ADD COLUMN IF NOT EXISTS baseline_roas NUMERIC;
