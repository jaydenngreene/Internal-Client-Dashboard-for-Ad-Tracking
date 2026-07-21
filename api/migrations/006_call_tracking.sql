-- Dynamic Number Insertion (DNI) call tracking. Numbers themselves are purchased by
-- the client in their own Twilio account and registered here via the API/setup
-- script — this project never buys phone numbers or touches billing on anyone's
-- behalf, same boundary as every other credential in this app.
CREATE TABLE IF NOT EXISTS tracking_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  forward_to TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'assigned')),
  assigned_visitor_id UUID REFERENCES visitors(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, phone_number)
);

CREATE INDEX IF NOT EXISTS idx_tracking_numbers_client_status ON tracking_numbers(client_id, status);
CREATE INDEX IF NOT EXISTS idx_tracking_numbers_visitor ON tracking_numbers(assigned_visitor_id);

CREATE TABLE IF NOT EXISTS calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tracking_number_id UUID REFERENCES tracking_numbers(id) ON DELETE SET NULL,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  caller_number TEXT,
  call_sid TEXT UNIQUE,
  status TEXT,
  duration_seconds INTEGER,
  recording_url TEXT,
  qualified BOOLEAN,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_calls_client_date ON calls(client_id, started_at);
CREATE INDEX IF NOT EXISTS idx_calls_session ON calls(session_id);
