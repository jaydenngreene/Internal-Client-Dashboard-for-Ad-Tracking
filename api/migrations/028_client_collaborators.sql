-- Lets a client be shared with more than one login instead of permanently belonging
-- to exactly one owner_user_id. No partial permission levels — a collaborator has
-- the exact same full read/write access to a client's data as its owner; the only
-- thing only the owner can do is manage who else has access (add/remove
-- collaborators, delete the client). Matches this app's existing "no roles
-- anywhere" simplicity rather than introducing a viewer/editor distinction nobody
-- asked for.
CREATE TABLE IF NOT EXISTS client_collaborators (
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_client_collaborators_user ON client_collaborators(user_id);
