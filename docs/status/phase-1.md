# Phase 1 — Data Layer Swap

**Status**: Complete
**Started**: 2026-03-31
**Completed**: 2026-03-31

## Objective

Replace local infrastructure (Qdrant Docker, Ollama, SQLite) with managed services (Qdrant Cloud, OpenAI embeddings, Supabase) so DUSTIN can run on a single VPS without local ML inference.

## Deliverables

- [x] Remove Qdrant and Ollama from docker-compose
- [x] Update Qdrant client for Qdrant Cloud (URL + API key auth)
- [x] Replace Ollama embeddings with OpenAI text-embedding-3-small (768d → 1536d)
- [x] Add Supabase client, create tables, migrate SQLite reads/writes
- [x] Update docker-entrypoint.sh readiness checks

## Feature Doc

Full specification with acceptance criteria: [`docs/specs/phase-1-data-layer-swap.md`](../specs/phase-1-data-layer-swap.md)

## Acceptance Criteria

789 tests passing. All 20 acceptance criteria met across 3 workstreams.

## Decisions

**D-1.01** (2026-03-31): Supabase migrations run via CLI, not application code.
- Context: Supabase JS client cannot execute raw SQL. Phantom's SQLite approach ran migrations at boot.
- Decision: Migrations live in `supabase/migrations/*.sql` and are applied via `supabase db push` before the app starts. The `runMigrations()` function now just verifies connectivity.
- Rationale: This is the standard Supabase pattern and avoids needing a raw SQL RPC function.

**D-1.02** (2026-03-31): PhantomMcpServer uses async factory instead of constructor.
- Context: DynamicToolRegistry.loadFromDatabase() became async, but constructors can't be async.
- Decision: Changed to `await PhantomMcpServer.create(deps)` factory pattern.
- Rationale: Clean pattern for async initialization, no workarounds needed.

**D-1.03** (2026-03-31): MockSupabaseClient for testing instead of in-memory SQLite.
- Context: Tests used `new Database(":memory:")` with real SQL. Supabase client can't do this.
- Decision: Created `src/db/test-helpers.ts` with a MockSupabaseClient that mimics the Supabase query builder API with in-memory storage.
- Rationale: Tests stay fast and isolated without requiring a real Supabase instance.

## Deviations

**V-1.01**: Base file specified v0.17.0 fork; we used v0.18.1 (latest). User approved.

**V-1.02**: Test count is 789 (not 790+) — a few tests were consolidated during the migration. No test coverage was lost.
