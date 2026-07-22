-- AI Recommendations ("Insights" tab) — one cached row per client, overwritten on
-- regenerate. On-demand + cached rather than a nightly job: cheap (no wasted API
-- spend on clients nobody's looking at), and staleness is visible via generated_at
-- instead of a silent nightly refresh nobody asked for.
CREATE TABLE IF NOT EXISTS client_insights (
  client_id UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  insights JSONB NOT NULL,
  model TEXT NOT NULL,
  error TEXT
);
