# Database Schema

DUSTIN uses Supabase (managed Postgres) for relational state and Qdrant Cloud for vector storage.

## Supabase Tables

### users

Primary user identity table. Maps Telegram user IDs to internal UUIDs.

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, default gen_random_uuid() |
| telegram_user_id | text | UNIQUE, NOT NULL |
| display_name | text | |
| role | text | CHECK ('owner', 'partner'), NOT NULL |
| created_at | timestamptz | default now() |

### config_versions

Tracks every evolved configuration change for auditability and rollback.

| Column | Type | Constraints |
|--------|------|-------------|
| id | serial | PK |
| version | int | NOT NULL |
| parent_version | int | |
| changes | jsonb | NOT NULL |
| metrics_snapshot | jsonb | |
| session_id | text | |
| created_at | timestamptz | default now() |

### notion_sync_state

Tracks Notion page sync status for bidirectional sync.

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, default gen_random_uuid() |
| page_id | text | UNIQUE, NOT NULL |
| last_modified | timestamptz | |
| content_hash | text | |
| synced_at | timestamptz | |

### audit_log

Append-only log of all significant actions for traceability.

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, default gen_random_uuid() |
| user_id | uuid | FK → users(id) |
| action | text | NOT NULL |
| resource_type | text | |
| resource_id | text | |
| details | jsonb | |
| created_at | timestamptz | default now() |

### tools

Registry of dynamically created tools.

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, default gen_random_uuid() |
| name | text | UNIQUE, NOT NULL |
| description | text | |
| handler_type | text | NOT NULL |
| handler_config | jsonb | NOT NULL |
| created_by | uuid | FK → users(id) |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

### evolution_observations

Raw observations extracted from sessions by the evolution engine.

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, default gen_random_uuid() |
| user_id | uuid | FK → users(id) |
| session_id | text | |
| observation_type | text | NOT NULL |
| content | text | NOT NULL |
| chat_context | text | CHECK ('group', 'dm_owner', 'dm_partner') |
| created_at | timestamptz | default now() |

## Qdrant Cloud Collections

All collections use 1536-dimensional vectors (OpenAI text-embedding-3-small). This is an upgrade from Phantom's 768d Ollama embeddings.

| Collection | Purpose | Dimensions |
|------------|---------|------------|
| episodic | Session transcripts as vector embeddings | 1536 |
| semantic | Accumulated facts with contradiction detection | 1536 |
| procedural | Learned workflows and step-by-step procedures | 1536 |

## Migration Conventions

- Migration files: `YYYYMMDDHHMMSS_description.sql` (timestamped SQL)
- Stored in `supabase/migrations/`
- Applied via Supabase CLI (`supabase db push`) or direct SQL execution
- Each migration is idempotent where possible (use `IF NOT EXISTS`)

## Security Model

RLS is not enabled initially. All database access uses the Supabase service role key, which is server-only (never exposed to clients). The application is a single-tenant system with two users (owner and partner), and all access flows through the Bun server process.

When multi-tenant or client-side access is introduced, RLS policies will be added. Until then, access control is enforced at the application layer.
