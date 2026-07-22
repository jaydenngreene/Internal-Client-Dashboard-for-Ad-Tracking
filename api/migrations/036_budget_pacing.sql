-- Step 43 — account-wide monthly budget target, matching this app's existing
-- "no per-campaign complexity unless asked for" simplicity (same level as
-- cogs_percent/payment_fee_percent — one number per client, not a budget-by-
-- campaign system).
ALTER TABLE clients ADD COLUMN IF NOT EXISTS monthly_budget_target NUMERIC;
