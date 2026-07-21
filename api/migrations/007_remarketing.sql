-- Step 12 — AI remarketing agent. A third-party identity-resolution vendor
-- (Customers.ai) runs its own separate "X-Ray" pixel on the client's site and posts
-- back real contact info for visitors it deanonymizes — this is distinct from our own
-- pixel's /track/identify, which only knows an email once the visitor gives it to us
-- directly (login/purchase/lead form). Candidates land here first for human review;
-- nothing in this table implies a message was ever sent.
CREATE TABLE IF NOT EXISTS remarketing_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'customers_ai',
  email TEXT NOT NULL,
  phone TEXT,
  first_name TEXT,
  last_name TEXT,
  page_url TEXT,
  page_title TEXT,
  identified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'dispatched')),
  draft_subject TEXT,
  draft_body TEXT,
  draft_generated_at TIMESTAMPTZ,
  draft_error TEXT,
  reviewed_at TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_remarketing_candidates_client_status
  ON remarketing_candidates(client_id, status, identified_at DESC);
