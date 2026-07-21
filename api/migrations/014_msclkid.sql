-- Step 18 — Bing/Microsoft UET offline conversion import needs the msclkid click
-- id captured end-to-end, same as fbclid/gclid already are.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS msclkid TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_msclkid ON sessions(msclkid) WHERE msclkid IS NOT NULL;
