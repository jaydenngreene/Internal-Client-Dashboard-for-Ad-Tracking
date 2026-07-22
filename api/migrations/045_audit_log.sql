-- Step 54 — audit log. With multiple users now (owner + collaborators, admin-
-- created logins), there was no record of who did what: who changed an
-- attribution model, who deleted a client, who added a collaborator. Generic by
-- design (route + method + status, not a bespoke row shape per action type) so
-- it can be populated by one shared hook instead of instrumenting every mutating
-- route by hand.
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  route TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  details TEXT,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_client ON audit_log(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id, created_at);
