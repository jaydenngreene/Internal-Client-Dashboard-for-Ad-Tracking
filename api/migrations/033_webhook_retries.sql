-- Step 38 — outbound webhook deliveries get retried instead of logged-and-dropped
-- on the first failure (migration 018's original comment explicitly called this out
-- as a deliberate scope cut "matching this app's existing scale" — revisited now
-- that reliability hardening is in scope). retry_count/next_retry_at drive a
-- scheduled retry job; a delivery stops being retried once retry_count hits the
-- job's max attempts, staying in the table as a permanent failure record.
ALTER TABLE outbound_webhook_deliveries
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_outbound_webhook_deliveries_retry
  ON outbound_webhook_deliveries(next_retry_at) WHERE next_retry_at IS NOT NULL;
