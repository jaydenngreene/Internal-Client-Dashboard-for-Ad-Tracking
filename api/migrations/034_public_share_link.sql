-- Step 40 — client-facing white-label report link. User explicitly chose a
-- shareable link over a real client-role login: no new permission model, revoke
-- by regenerating. Stored in plaintext (not hashed like password-reset tokens) —
-- the data behind it is read-only revenue/cost numbers, not account credentials,
-- and plaintext lets the dashboard just show the existing link again without a
-- one-time-reveal flow. High-entropy (32 random bytes) so it's not guessable.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS public_share_token TEXT UNIQUE;
