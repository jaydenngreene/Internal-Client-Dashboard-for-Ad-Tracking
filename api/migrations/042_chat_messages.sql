-- Step 51 — conversational AI chat. One thread per client (not multi-conversation
-- management, matching this app's "simple, no premature abstraction" convention) —
-- every message either side of the conversation is stored so the thread persists
-- across page reloads.
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_client ON chat_messages(client_id, created_at);
