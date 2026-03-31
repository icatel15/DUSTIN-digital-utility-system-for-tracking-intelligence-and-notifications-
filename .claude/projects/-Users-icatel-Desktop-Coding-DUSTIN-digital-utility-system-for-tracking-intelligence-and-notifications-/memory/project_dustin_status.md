---
name: DUSTIN Project Status
description: Current implementation phase and key decisions for the DUSTIN AI assistant project
type: project
---

DUSTIN is forked from ghostwright/phantom v0.18.1 (789 tests passing). Phase 0 and Phase 1 complete as of 2026-03-31. Phase 2 (Telegram + two-user support) is next.

**Phase 1 key changes:**
- Qdrant Cloud: API key auth added to QdrantClient, removed local Docker container
- OpenAI embeddings: Replaced Ollama with text-embedding-3-small (768d→1536d), dimensions now config-driven
- Supabase: Replaced all bun:sqlite with @supabase/supabase-js, 15+ production files converted sync→async
- PhantomMcpServer uses factory pattern (`create()`) due to async initialization
- Test mock: `src/db/test-helpers.ts` provides MockSupabaseClient for all tests
- Migrations: SQL files in `supabase/migrations/`, applied via CLI, not app code

**Why:** VPS becomes purely compute — no critical data on the VM.

**How to apply:** Phase 2 can proceed independently. User needs to set up Qdrant Cloud, Supabase, and OpenAI accounts before deploying.
