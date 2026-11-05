-- Phone number on the order itself. For phone-only checkouts (no email) the
-- purchase's `email` holds a stand-in key "phone:+1..." (see lib/customerKey.ts);
-- this column holds the real number for every order that has one, so it can be
-- sent to ad platforms as a match key.
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS phone TEXT;
CREATE INDEX IF NOT EXISTS idx_identities_client_phone ON identities(client_id, phone) WHERE phone IS NOT NULL;
