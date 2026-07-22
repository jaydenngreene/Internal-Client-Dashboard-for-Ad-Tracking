-- Step 53 — IP-derived country/region on sessions, the prerequisite for true
-- geo-lift/holdout testing (confirmed absent from this app entirely while
-- scoping Step 45, which built a time-based pause test as the buildable
-- alternative instead). Nullable — a private/loopback IP or a lookup miss
-- leaves both null rather than a wrong guess.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS region TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_region ON sessions(client_id, region) WHERE region IS NOT NULL;
