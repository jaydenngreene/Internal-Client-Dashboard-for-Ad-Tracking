-- Multi-tenant login: each agency user only ever sees their own clients. Nothing
-- existed before this — the whole dashboard-facing API was unauthenticated by
-- design, fine for a single-operator dev setup but not once a second person gets
-- their own login. owner_user_id is nullable so this migration never has to
-- backfill/guess ownership for any pre-existing client rows; every route that
-- creates a client always sets it from the authenticated request going forward,
-- and every read is scoped to it (see lib/ownership.ts).
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE clients ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_clients_owner ON clients(owner_user_id);
