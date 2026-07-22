-- Password reset tokens are stored hashed (never plaintext), same principle as
-- password_hash itself — anyone reading the DB directly still can't use a leaked
-- row to reset someone's password.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_reset_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_verification_token_hash TEXT;
