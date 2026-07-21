-- Fixes a real bug caught during Step 15 verification: the original unique
-- constraint on identity_links was (client_id, primary_identity_id, linked_identity_id)
-- with no `mechanism` — so when a stronger phone_number match arrived for a pair that
-- already had a weaker ip match, ON CONFLICT DO NOTHING silently dropped the stronger
-- evidence instead of recording it. Each mechanism between a pair is now its own row —
-- a fuller, more honest audit trail (e.g. a pair linked by both ip AND phone_number
-- shows both), and nothing is ever silently lost to a conflict again.
ALTER TABLE identity_links DROP CONSTRAINT IF EXISTS identity_links_client_id_primary_identity_id_linked_identit_key;
ALTER TABLE identity_links ADD CONSTRAINT identity_links_client_primary_linked_mechanism_key
  UNIQUE (client_id, primary_identity_id, linked_identity_id, mechanism);
