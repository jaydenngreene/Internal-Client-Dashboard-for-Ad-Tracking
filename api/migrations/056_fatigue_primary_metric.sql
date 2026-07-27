-- Review fix (2026-07-28, item 8, corrected): recent_ctr/prior_ctr/decline_pct
-- were always written from CTR regardless of which metric actually triggered
-- the flag, so an ad flagged solely on ROAS or CPA got a decline_pct that
-- could read as zero or even negative — a false claim about why it was
-- flagged, not just a display bug. primary_metric records which metric those
-- three columns actually represent, so the row is self-describing.
ALTER TABLE creative_fatigue_signals ADD COLUMN IF NOT EXISTS primary_metric TEXT;
