-- Step 55 — TOTP-based 2FA/MFA. Password-only auth was the only option before
-- this, despite this now being a genuine multi-user system with shared client
-- access. totp_secret is stored plaintext (standard practice for TOTP — it must
-- be readable to verify each login, unlike password_hash) but is never exposed
-- via any GET response. Backup codes are hashed the same way password-reset
-- tokens already are (lib/auth.ts's hashToken, SHA-256) since they're
-- high-entropy random values, not user-chosen secrets.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS totp_secret TEXT,
  ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfa_backup_codes_hash TEXT[] NOT NULL DEFAULT '{}';
