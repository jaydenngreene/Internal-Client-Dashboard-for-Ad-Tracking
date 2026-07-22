-- Step 48 — multi-currency support. Every dollar amount in this app (ad spend,
-- purchase revenue) was silently assumed to already be in whatever currency the
-- reports display, with zero conversion anywhere — a real problem for a client
-- running ads or taking payments in more than one currency. clients.currency is
-- the client's reporting/base currency; conversion happens ONCE at ingestion
-- (recordPurchase for purchases, upsertAdCosts for ad spend) so every existing
-- report query keeps summing a single already-converted number, unchanged.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';

-- Daily exchange-rate cache — avoids hitting the free rates API on every single
-- purchase/ad-cost row. One row per (date, base, target) triple.
CREATE TABLE IF NOT EXISTS exchange_rates (
  date DATE NOT NULL,
  base_currency TEXT NOT NULL,
  target_currency TEXT NOT NULL,
  rate NUMERIC(18, 8) NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (date, base_currency, target_currency)
);
