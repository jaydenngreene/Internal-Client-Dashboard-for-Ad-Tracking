-- Step 57 — lets a client owner opt into a periodic email summary (share links
-- exist but nothing proactively sends anything). 'none' is the default so this
-- is opt-in, not a new unsolicited email every existing client starts getting.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS report_schedule_frequency TEXT NOT NULL DEFAULT 'none'
  CHECK (report_schedule_frequency IN ('none', 'weekly', 'monthly'));
