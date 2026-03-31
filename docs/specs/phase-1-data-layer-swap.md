# Phase 1 — Data Layer Swap

## Overview

Replace Phantom's co-located infrastructure (Qdrant Docker, Ollama, SQLite) with managed services (Qdrant Cloud, OpenAI embeddings, Supabase Postgres). After this phase, the VPS is purely compute — no critical data lives on it.

## Scope

Three workstreams, ordered by dependency:

1. **WS-1: Qdrant Cloud** — Point the existing Qdrant client at a managed instance with API key auth
2. **WS-2: OpenAI Embeddings** — Replace Ollama's `EmbeddingClient` with OpenAI `text-embedding-3-small`
3. **WS-3: Supabase** — Replace SQLite with Supabase Postgres for all relational state

WS-1 and WS-2 are tightly coupled (both in `src/memory/`) and should be done together. WS-3 is independent and can be done in parallel.

## Reconnaissance Summary

| Service | Abstraction | Key File | Coupling |
|---------|-------------|----------|----------|
| Qdrant | `QdrantClient` class | `src/memory/qdrant-client.ts` | Contained in `src/memory/` — all 3 stores use it via constructor injection |
| Ollama | `EmbeddingClient` class | `src/memory/embeddings.ts` | Contained in `src/memory/` — all 3 stores use it via constructor injection |
| SQLite | `getDatabase()` singleton | `src/db/connection.ts` | Used by 6+ modules via dependency injection (session-store, cost-tracker, scheduler, secrets, onboarding, dynamic-tools) |

---

## WS-1: Qdrant Cloud

### Changes

**`src/memory/qdrant-client.ts`** — Add `api-key` header to all requests:
- Constructor reads `QDRANT_API_KEY` from config
- `request()` method (line 257) adds `api-key: <key>` header alongside `Content-Type`
- `collectionExists()` (line 48) and `isHealthy()` (line 160) add the same header to their direct `fetch()` calls

**`src/config/schemas.ts`** — Extend `MemoryConfigSchema.qdrant`:
- Add `api_key: z.string().optional()` field
- Existing `url` field already supports remote URLs

**`src/memory/config.ts`** — Add env override:
- Read `QDRANT_API_KEY` from `process.env`, apply to config

**`config/memory.yaml`** — Update defaults:
- Document Qdrant Cloud URL format (`https://xxx.cloud.qdrant.io:6333`)

**`docker-compose.yaml`** — Remove Qdrant service block (lines 60-77) and `qdrant_data` volume

**`docker-compose.user.yaml`** — Same removal

**`docker-compose.quick.yaml`** — Already has no Qdrant; no change needed

### Acceptance Criteria

- [ ] AC-1.1: Agent connects to Qdrant Cloud endpoint using `QDRANT_URL` and `QDRANT_API_KEY` env vars
- [ ] AC-1.2: All three collections (episodes, semantic_facts, procedures) are created on Qdrant Cloud if they don't exist
- [ ] AC-1.3: `MemorySystem.healthCheck()` returns `{ qdrant: true }` when connected to Qdrant Cloud
- [ ] AC-1.4: Store and recall operations work identically to local Qdrant (episodes, facts, procedures)
- [ ] AC-1.5: Hybrid search (dense + sparse RRF fusion) works against Qdrant Cloud
- [ ] AC-1.6: Docker Compose files no longer define a Qdrant service or volume
- [ ] AC-1.7: All existing memory tests pass with updated mocks

---

## WS-2: OpenAI Embeddings

### Changes

**`src/memory/embeddings.ts`** — Replace `EmbeddingClient` internals:
- Constructor reads `OPENAI_API_KEY` and model name from config (not Ollama URL)
- `embed()` calls `https://api.openai.com/v1/embeddings` with `Authorization: Bearer <key>`
- `embedBatch()` same endpoint, batched input
- `isHealthy()` pings OpenAI API (or returns true if key is set — OpenAI has no dedicated health endpoint)
- `textToSparseVector()` and `stableHash()` are unchanged (local computation, no service dependency)

**`src/config/schemas.ts`** — Replace `MemoryConfigSchema.ollama` with `embeddings`:
```
embeddings: z.object({
  provider: z.enum(["openai", "ollama"]).default("openai"),
  api_key: z.string().optional(),
  model: z.string().default("text-embedding-3-small"),
  url: z.string().url().optional(),  // Only for ollama provider
})
```

**`src/config/schemas.ts`** — Update `MemoryConfigSchema.embedding.dimensions`:
- Default changes from `768` to `1536` (text-embedding-3-small output dimension)

**`src/memory/config.ts`** — Update env overrides:
- Replace `OLLAMA_URL` / `EMBEDDING_MODEL` with `OPENAI_API_KEY` / `EMBEDDING_MODEL`
- Keep `EMBEDDING_MODEL` env var for flexibility

**`src/memory/system.ts`** — Update `MemoryHealth` type:
- Replace `ollama: boolean` with `embeddings: boolean`
- Update `healthCheck()` and `initialize()` log messages

**`src/memory/types.ts`** — Update `MemoryHealth`:
- `ollama` field becomes `embeddings`

**`src/core/server.ts`** — Update health endpoint:
- Report `memory.embeddings` instead of `memory.ollama`

**`src/memory/episodic.ts`, `semantic.ts`, `procedural.ts`** — Update vector dimensions:
- Collection schemas change from `768` to `1536` for dense vectors

**`docker-compose.yaml`** — Remove Ollama service block (lines 82-95) and `ollama_data` volume

**`docker-compose.user.yaml`** — Same removal

**`scripts/docker-entrypoint.sh`** — Remove Ollama readiness check and model pull logic (lines 32-62). Remove Qdrant readiness check (lines 18-30). Add connectivity checks for Qdrant Cloud and OpenAI API.

### Acceptance Criteria

- [ ] AC-2.1: `EmbeddingClient.embed("test")` returns a 1536-dimension vector from OpenAI
- [ ] AC-2.2: `EmbeddingClient.embedBatch(["a","b"])` returns two 1536-dimension vectors
- [ ] AC-2.3: `EmbeddingClient.isHealthy()` returns true when `OPENAI_API_KEY` is valid
- [ ] AC-2.4: Qdrant collections are created with 1536-dimension vector config
- [ ] AC-2.5: Hybrid search (dense + sparse) works end-to-end with OpenAI embeddings
- [ ] AC-2.6: Docker Compose files no longer define an Ollama service or volume
- [ ] AC-2.7: `docker-entrypoint.sh` no longer references Ollama or pulls embedding models
- [ ] AC-2.8: All existing memory tests pass with updated mocks (embedding dimension changes)
- [ ] AC-2.9: `textToSparseVector()` is unmodified and continues to work (unit test)

---

## WS-3: Supabase (SQLite Replacement)

### Changes

**`src/db/connection.ts`** — Replace entirely:
- Remove `bun:sqlite` import and singleton
- Add `@supabase/supabase-js` client creation using `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`
- Export `getSupabase()` returning `SupabaseClient`
- Export `createTestDatabase()` returning a mock or test Supabase client

**`src/db/schema.ts`** — Replace SQLite DDL with Supabase migration:
- Create `supabase/migrations/` directory
- Initial migration creates Phantom's existing tables (sessions, cost_events, onboarding_state, dynamic_tools, scheduled_jobs, secrets, secret_requests) in Postgres syntax
- Second migration creates DUSTIN-specific tables (users, config_versions, notion_sync_state, audit_log, evolution_observations) per `docs/reference/schema.md`

**`src/db/migrate.ts`** — Update for Postgres:
- Run migrations via Supabase SQL or migration runner

**Consumers** — Convert sync SQLite calls to async Supabase calls. Each file needs `db.query()` → `supabase.from().select()` style changes:

| File | Tables Used | Change Scope |
|------|-------------|-------------|
| `src/agent/session-store.ts` | sessions | Moderate — CRUD operations |
| `src/agent/cost-tracker.ts` | cost_events, sessions | Moderate — inserts + aggregation |
| `src/scheduler/service.ts` | scheduled_jobs | Moderate — CRUD + index queries |
| `src/secrets/store.ts` | secrets, secret_requests | Moderate — CRUD operations |
| `src/onboarding/flow.ts` | onboarding_state | Small — simple state read/write |
| `src/mcp/dynamic-tools.ts` | dynamic_tools | Moderate — CRUD + list |
| `src/agent/runtime.ts` | (uses session-store) | Small — already injected |
| `src/index.ts` | (initialization) | Small — swap init call |

**Key challenge**: Bun SQLite is synchronous; Supabase client is async. All `db.query().get()` and `db.run()` calls become `await supabase.from(...).select(...)`. Callers that aren't already async will need to become async.

**`src/config/schemas.ts`** — Add Supabase config:
- Add `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` to config schema or rely on env vars directly

### Acceptance Criteria

- [ ] AC-3.1: Agent boots and connects to Supabase using `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`
- [ ] AC-3.2: All 7 Phantom tables exist in Supabase with Postgres-compatible schema
- [ ] AC-3.3: All 6 DUSTIN-specific tables exist per `docs/reference/schema.md`
- [ ] AC-3.4: Session creation and retrieval works via Supabase
- [ ] AC-3.5: Cost tracking inserts and aggregation work via Supabase
- [ ] AC-3.6: Scheduled jobs CRUD works via Supabase
- [ ] AC-3.7: Secrets encryption/storage/retrieval works via Supabase
- [ ] AC-3.8: Dynamic tool registration and listing works via Supabase
- [ ] AC-3.9: Onboarding state persists across restarts via Supabase
- [ ] AC-3.10: All existing tests pass (with Supabase mocks replacing SQLite mocks)
- [ ] AC-3.11: No `bun:sqlite` imports remain in the codebase

---

## Cross-Workstream

### Docker Compose (final state)

After Phase 1, `docker-compose.yaml` defines only the DUSTIN container itself. No Qdrant, no Ollama. The container needs:
- `QDRANT_URL`, `QDRANT_API_KEY` (Qdrant Cloud)
- `OPENAI_API_KEY` (embeddings)
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (Postgres)
- All existing env vars (Anthropic, Telegram, etc.)

### Entrypoint Script (final state)

`scripts/docker-entrypoint.sh` after Phase 1:
1. Restore default phantom-config if first run (unchanged)
2. Connectivity check: Qdrant Cloud reachable (with API key)
3. Connectivity check: OpenAI API reachable
4. Connectivity check: Supabase reachable
5. Run `phantom init --yes` if first run (unchanged)
6. Start DUSTIN (unchanged)

---

## Test Strategy

### Tier 1 (Unit — all workstreams)

- Mock `fetch()` for Qdrant Cloud API calls (add `api-key` header assertion)
- Mock `fetch()` for OpenAI embeddings API (assert correct request shape, 1536d response)
- Mock Supabase client for all DB consumers
- Verify `textToSparseVector()` unchanged
- Verify config schema validation for new fields

### Tier 2 (Integration — WS-3 only)

- Supabase test project with real Postgres
- Run migrations, verify all tables created
- CRUD operations for each table
- Verify foreign key constraints work

### Tier 3 (External — all workstreams)

- Real Qdrant Cloud: create collection, upsert, search, delete
- Real OpenAI API: embed text, verify dimension
- Real Supabase: full migration + CRUD cycle
- These run separately, not on every commit

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Sync-to-async migration introduces bugs in DB consumers | Medium | High | Convert one consumer at a time, run tests after each |
| Qdrant Cloud API differs from local Qdrant | Low | Medium | Same REST API; only auth header is new |
| OpenAI embedding dimensions break sparse vector assumptions | Low | Low | Sparse vectors are independent of dense dimensions |
| Supabase free tier rate limits | Low | Low | Single-user app, low query volume |
| Test mocks diverge from real service behavior | Medium | Medium | Tier 3 external integration tests catch this |

---

## Implementation Order

1. **WS-1 + WS-2 together** (memory module, ~2 days)
   - Update config schema and types first
   - Replace `EmbeddingClient` internals
   - Add API key auth to `QdrantClient`
   - Update vector dimensions in stores
   - Update health checks and entrypoint
   - Remove Qdrant/Ollama from Docker Compose
   - Fix all memory tests

2. **WS-3** (database module, ~3 days)
   - Create Supabase migration files
   - Replace `src/db/connection.ts`
   - Convert consumers one at a time: onboarding → session-store → cost-tracker → scheduler → secrets → dynamic-tools
   - Fix all DB-dependent tests
   - Add DUSTIN-specific tables

3. **Integration pass** (~1 day)
   - Full test suite green
   - Docker Compose tested with managed services only
   - Entrypoint script verified
   - Health endpoint reports correct status
