# Phase 1 — Data Layer Swap

**Status**: Not started
**Depends on**: Phase 0 completion

## Objective

Replace local infrastructure (Qdrant Docker, Ollama, SQLite) with managed services (Qdrant Cloud, OpenAI embeddings, Supabase) so DUSTIN can run on a single VPS without local ML inference.

## Deliverables

- [ ] Remove Qdrant and Ollama from docker-compose
- [ ] Update Qdrant client for Qdrant Cloud (URL + API key auth)
- [ ] Replace Ollama embeddings with OpenAI text-embedding-3-small (768d → 1536d)
- [ ] Add Supabase client, create tables, migrate SQLite reads/writes
- [ ] Update docker-entrypoint.sh readiness checks (remove Qdrant/Ollama health checks, add Supabase/Qdrant Cloud connectivity checks)

## Feature Doc

Full specification with acceptance criteria: [`docs/phase-1-data-layer-swap.md`](../phase-1-data-layer-swap.md)

## Acceptance Criteria

See feature doc. Summary: 20 acceptance criteria across 3 workstreams (WS-1: Qdrant Cloud, WS-2: OpenAI Embeddings, WS-3: Supabase).

## Decisions

No decisions logged yet for this phase.

## Deviations

No deviations logged yet for this phase.
