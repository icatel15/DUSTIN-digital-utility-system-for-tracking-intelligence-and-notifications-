-- DUSTIN-specific tables for two-user model, Notion sync, evolution tracking.

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_user_id TEXT UNIQUE NOT NULL,
    display_name TEXT,
    role TEXT NOT NULL CHECK (role IN ('owner', 'partner')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS config_versions (
    id SERIAL PRIMARY KEY,
    version INTEGER NOT NULL,
    parent_version INTEGER,
    changes JSONB NOT NULL,
    metrics_snapshot JSONB,
    session_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notion_sync_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id TEXT UNIQUE NOT NULL,
    last_modified TIMESTAMPTZ,
    content_hash TEXT,
    synced_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evolution_observations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    session_id TEXT,
    observation_type TEXT NOT NULL,
    content TEXT NOT NULL,
    chat_context TEXT CHECK (chat_context IN ('group', 'dm_owner', 'dm_partner')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
