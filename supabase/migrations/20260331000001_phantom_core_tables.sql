-- Phantom core tables (migrated from SQLite)
-- These tables support the agent runtime, session management, and cost tracking.

CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL PRIMARY KEY,
    session_key TEXT UNIQUE NOT NULL,
    sdk_session_id TEXT,
    channel_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    total_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    turn_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cost_events (
    id SERIAL PRIMARY KEY,
    session_key TEXT NOT NULL REFERENCES sessions(session_key),
    cost_usd DOUBLE PRECISION NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    model TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS onboarding_state (
    id SERIAL PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS dynamic_tools (
    name TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    input_schema TEXT NOT NULL,
    handler_type TEXT NOT NULL DEFAULT 'shell',
    handler_code TEXT,
    handler_path TEXT,
    registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    registered_by TEXT
);

CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    enabled BOOLEAN NOT NULL DEFAULT true,
    schedule_kind TEXT NOT NULL,
    schedule_value TEXT NOT NULL,
    task TEXT NOT NULL,
    delivery_channel TEXT DEFAULT 'slack',
    delivery_target TEXT DEFAULT 'owner',
    status TEXT NOT NULL DEFAULT 'active',
    last_run_at TIMESTAMPTZ,
    last_run_status TEXT,
    last_run_duration_ms INTEGER,
    last_run_error TEXT,
    next_run_at TIMESTAMPTZ,
    run_count INTEGER NOT NULL DEFAULT 0,
    consecutive_errors INTEGER NOT NULL DEFAULT 0,
    delete_after_run BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by TEXT DEFAULT 'agent',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_next_run
    ON scheduled_jobs(next_run_at)
    WHERE enabled = true AND status = 'active';

CREATE TABLE IF NOT EXISTS secrets (
    name TEXT PRIMARY KEY,
    encrypted_value TEXT NOT NULL,
    iv TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    field_type TEXT NOT NULL DEFAULT 'password',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_accessed_at TIMESTAMPTZ,
    access_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS secret_requests (
    request_id TEXT PRIMARY KEY,
    fields_json TEXT NOT NULL,
    purpose TEXT NOT NULL,
    notify_channel TEXT,
    notify_channel_id TEXT,
    notify_thread TEXT,
    magic_token_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    urgency TEXT NOT NULL DEFAULT 'normal',
    source_channel TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    result TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS mcp_audit (
    id SERIAL PRIMARY KEY,
    client_name TEXT NOT NULL,
    method TEXT NOT NULL,
    tool_name TEXT,
    resource_uri TEXT,
    input_summary TEXT,
    output_summary TEXT,
    status TEXT NOT NULL DEFAULT 'ok',
    cost_usd DOUBLE PRECISION DEFAULT 0,
    duration_ms INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
