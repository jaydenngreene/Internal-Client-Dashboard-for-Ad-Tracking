-- Every scheduled job (ad-cost sync, LTV refresh, audience sync) previously only
-- ever logged failure to console.error - nothing recorded whether a run happened
-- at all, or surfaced it to anyone. One row per run, latest queryable per job name.
CREATE TABLE IF NOT EXISTS job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failure')),
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_runs_name_finished ON job_runs(job_name, finished_at DESC);
