-- Conversation audit trail: stores every message (user, assistant, tool_use)
-- for debugging and self-querying. Append-only by design.

CREATE TABLE IF NOT EXISTS conversation_messages (
    id              SERIAL PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    session_id      TEXT,
    channel_id      TEXT NOT NULL,
    sender_id       TEXT NOT NULL,
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool_use')),
    content         TEXT NOT NULL,
    tool_name       TEXT,
    tool_input      JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Full-text search vector, auto-maintained by Postgres
    tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);

CREATE INDEX IF NOT EXISTS idx_conv_msgs_conversation_id
    ON conversation_messages(conversation_id);

CREATE INDEX IF NOT EXISTS idx_conv_msgs_channel_id
    ON conversation_messages(channel_id);

CREATE INDEX IF NOT EXISTS idx_conv_msgs_created_at
    ON conversation_messages(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conv_msgs_role
    ON conversation_messages(role);

CREATE INDEX IF NOT EXISTS idx_conv_msgs_session_id
    ON conversation_messages(session_id)
    WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conv_msgs_tsv
    ON conversation_messages USING GIN(tsv);
