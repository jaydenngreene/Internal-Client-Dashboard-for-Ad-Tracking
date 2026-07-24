-- Gojo chat: lets an assistant message carry the structured tool results it was
-- built from (see api/src/lib/chatTools.ts), so the dashboard can render a real
-- inline stat tile or mini table alongside the prose answer instead of text only -
-- the actual differentiator behind Triple Whale's Moby, not the chat surface
-- itself. Null for every user message and for any assistant message that
-- answered without calling a tool.
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS tool_calls JSONB;
