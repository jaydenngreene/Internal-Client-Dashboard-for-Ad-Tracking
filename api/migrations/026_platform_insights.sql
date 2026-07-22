-- "Overall insights should be per platform as well, not overall overall" — a client
-- running Facebook, Google, and TikTok wants one insight per platform, not a single
-- blended whole-account number. Adds 'platform' alongside the existing client/campaign/
-- creative scopes from migration 025; scope_platform holds the platform, scope_key stays
-- NULL (same "no key" convention the client scope already uses).
ALTER TABLE client_insights DROP CONSTRAINT client_insights_scope_type_check;
ALTER TABLE client_insights ADD CONSTRAINT client_insights_scope_type_check
  CHECK (scope_type IN ('client', 'campaign', 'creative', 'platform'));
