-- Lets the dashboard show each user's own agency name instead of generic
-- branding, and gives registration a natural third field beyond email/password.
ALTER TABLE users ADD COLUMN IF NOT EXISTS agency_name TEXT;
