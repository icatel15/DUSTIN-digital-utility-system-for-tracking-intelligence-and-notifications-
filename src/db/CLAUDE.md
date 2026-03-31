# src/db/ — Database client, connectivity, and test helpers

Universal rules (methodology, TDD, DFD, code style) are governed by the root `CLAUDE.md`.

## Database Engine

Production uses **Supabase Postgres** via `@supabase/supabase-js`. Actual schema migrations live in `supabase/migrations/*.sql` and are applied via the Supabase CLI (`supabase db push`), not at runtime.

## File Inventory

| File | Purpose |
| --- | --- |
| `connection.ts` | Singleton Supabase client factory (`getDatabase`), teardown (`closeDatabase`), and a `createTestDatabase` helper for integration tests |
| `migrate.ts` | Connectivity check (`runMigrations`) — verifies the `sessions` table is reachable; does **not** apply DDL |
| `schema.ts` | Reference-only schema documentation and `SCHEMA_VERSION` constant. Not used at runtime |
| `test-helpers.ts` | `MockSupabaseClient` — in-memory mock implementing `from/select/insert/update/delete/upsert/rpc` for unit tests |
| `__tests__/migrate.test.ts` | Unit tests for `runMigrations` using the mock client |

## Connection Management

- `getDatabase()` is a **lazy singleton**. It reads `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` from env on first call and throws if either is missing.
- Auth options disable `autoRefreshToken` and `persistSession` (server-side usage).
- `closeDatabase()` nulls the cached client for teardown.

## Migration Conventions

- DDL lives in `supabase/migrations/` as timestamped `.sql` files.
- `runMigrations()` only performs a connectivity smoke test (SELECT from `sessions`). It is called at startup to fail fast if the database is unreachable or migrations have not been applied.

## Test Helpers

- `MockSupabaseClient` supports chained query builders (`eq`, `neq`, `in`, `gte`, `lte`, `lt`, `not`, `order`, `limit`, `single`, `maybeSingle`).
- Auto-generates IDs for inserted rows when no `id`, `request_id`, `name`, or `session_key` field is present.
- `upsert` supports `onConflict` key matching.
- Use `createMockSupabase()` in unit tests instead of connecting to a real instance.

## Dependencies

- `@supabase/supabase-js` — Supabase client SDK

## Update Protocol

Update this file when adding new database utilities, changing the connection pattern, modifying the mock client API, or adding tables to the schema reference.
