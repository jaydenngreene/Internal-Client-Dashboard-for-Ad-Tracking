-- Step 36 — call transcription + AI scoring, using Twilio's own built-in
-- transcription (no new vendor, per explicit user decision) rather than a
-- dedicated speech-to-text service. AI fields are deliberately separate from the
-- existing human-set qualification_score/disposition (migration 009) — a
-- suggestion a human can see and act on, never a silent overwrite of manual review.
ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS recording_sid TEXT,
  ADD COLUMN IF NOT EXISTS transcription_sid TEXT,
  ADD COLUMN IF NOT EXISTS transcript TEXT,
  ADD COLUMN IF NOT EXISTS transcript_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_qualification_score NUMERIC(3, 2) CHECK (ai_qualification_score BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS ai_disposition TEXT CHECK (
    ai_disposition IN ('new_lead', 'qualified', 'unqualified', 'existing_customer', 'wrong_number', 'voicemail', 'spam')
  ),
  ADD COLUMN IF NOT EXISTS ai_summary TEXT;
