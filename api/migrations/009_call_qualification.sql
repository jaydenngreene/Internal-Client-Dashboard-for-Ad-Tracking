-- Step 23 — continuous qualification score + disposition taxonomy, additive
-- alongside the existing boolean `qualified` column (left untouched so existing
-- reports/queries built against it keep working unchanged).
ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS qualification_score NUMERIC(3, 2) CHECK (qualification_score BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS disposition TEXT CHECK (
    disposition IN ('new_lead', 'qualified', 'unqualified', 'existing_customer', 'wrong_number', 'voicemail', 'spam')
  );
