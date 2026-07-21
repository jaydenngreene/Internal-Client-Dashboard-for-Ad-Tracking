-- Prevent duplicate purchase records on webhook retries (Stripe retries aggressively).
-- ON CONFLICT DO NOTHING in the webhook handlers relies on this constraint to be idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_client_order_unique
  ON purchases (client_id, order_id)
  WHERE order_id IS NOT NULL;
