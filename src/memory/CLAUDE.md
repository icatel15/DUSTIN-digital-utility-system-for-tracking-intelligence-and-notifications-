# Long-Term Memory System

Three-tier vector memory (episodic, semantic, procedural) backed by Qdrant and OpenAI embeddings. Stores and recalls knowledge across sessions to give the agent persistent context.

Universal rules are governed by the root `CLAUDE.md`.

## Service Inventory

| File | Responsibility |
|---|---|
| `system.ts` | `MemorySystem` facade -- initializes all stores, delegates store/recall/find operations, health checks, degraded-mode handling |
| `episodic.ts` | `EpisodicStore` -- stores and recalls task episodes with summary+detail dual vectors and BM25 sparse |
| `semantic.ts` | `SemanticStore` -- stores versioned facts as subject-predicate-object triples; detects and resolves contradictions |
| `procedural.ts` | `ProceduralStore` -- stores repeatable workflows with trigger conditions, steps, and success/failure tracking |
| `embeddings.ts` | `EmbeddingClient` -- OpenAI embedding calls (single + batch); `textToSparseVector()` for BM25-style sparse vectors |
| `qdrant-client.ts` | `QdrantClient` -- HTTP client for Qdrant REST API: collection CRUD, upsert, search (dense/sparse/hybrid), payload operations |
| `ranking.ts` | Episode recall scoring -- weighted signals (similarity, durability, recency) with exponential decay and access reinforcement |
| `context-builder.ts` | `MemoryContextBuilder` -- assembles memory context string for the agent within a token budget |
| `consolidation.ts` | Session-end consolidation -- LLM judge (Sonnet) extracts facts/procedures/contradictions; heuristic fallback via regex patterns |
| `config.ts` | Loads `config/memory.yaml` via Zod schema; applies env var overrides (QDRANT_URL, OPENAI_API_KEY, etc.) |
| `types.ts` | All shared types: Episode, SemanticFact, Procedure, RecallOptions, SparseVector, QdrantPoint, etc. |

## Three Memory Tiers

### Episodic (what happened)
- **Collection**: configured via `config.collections.episodes`
- **Vectors**: `summary` (dense), `detail` (dense), `text_bm25` (sparse)
- **Payload indexes**: type, outcome, session_id, user_id, importance, tools_used, files_touched, timestamps
- **Recall strategies**: recency (default), similarity, temporal, metadata -- each applies different weight distributions

### Semantic (what is known)
- **Collection**: configured via `config.collections.semantic_facts`
- **Vectors**: `fact` (dense), `text_bm25` (sparse)
- **Structure**: Subject-predicate-object triples with natural language description
- **Versioning**: Facts have `valid_from`/`valid_until`; contradictions resolved by confidence (higher confidence supersedes)
- **Categories**: user_preference, domain_knowledge, team, codebase, process, tool

### Procedural (how to do things)
- **Collection**: configured via `config.collections.procedures`
- **Vectors**: `description` (dense), `text_bm25` (sparse)
- **Structure**: Named procedures with trigger, ordered steps, pre/post-conditions, parameters
- **Tracking**: success_count, failure_count, last_used_at, confidence, version

## Embedding Pipeline

- **Model**: OpenAI `text-embedding-3-small` (configurable via config or `EMBEDDING_MODEL` env var)
- **Dimensions**: 1536 (configurable via `config.embedding.dimensions`)
- **Dense vectors**: Via `EmbeddingClient.embed()` / `embedBatch()` calling OpenAI API
- **Sparse vectors**: BM25-style term frequency vectors via `textToSparseVector()` using FNV-1a hashing for stable token-to-index mapping

## Hybrid Search

All three stores use dense + BM25 sparse search combined via Reciprocal Rank Fusion (RRF):
- Qdrant's `prefetch` sends both dense and sparse queries
- Results fused with `{ fusion: "rrf" }` in the query API
- Falls back to dense-only or sparse-only if one vector type is unavailable

## Context Builder

`MemoryContextBuilder.build(query)` assembles memory context for the agent:
1. Parallel recall of episodes, facts, and relevant procedure
2. **Facts first** (priority) -- formatted as bullet list with confidence scores
3. **Episodes next** -- filtered through `shouldIncludeEpisodeInContext()` (importance >= 0.85, access_count >= 3, or context score above threshold)
4. **Procedure last** -- steps, trigger, success/failure stats
5. Token budget enforced throughout (configurable via `config.context.max_tokens`; estimates ~4 chars/token)

## Consolidation

Two paths, both in `consolidation.ts`:
- **LLM** (`consolidateSessionWithLLM`): Uses the consolidation judge from `src/evolution/judges/consolidation-judge.ts` to extract structured facts, procedures, and contradiction alerts.
- **Heuristic** (`consolidateSession`): Regex-based extraction of corrections and preferences from user messages.

Both create an Episode and store extracted SemanticFacts. Importance is calculated from outcome, tool usage, and file modifications.

## Key Invariants

- `MemorySystem` returns empty/null results when not initialized (degraded mode) -- never throws.
- Contradiction resolution: new fact with >= confidence supersedes old fact (sets `valid_until`).
- Episode access counts updated in background (best-effort, non-blocking).
- Ranking uses exponential decay with configurable half-lives (14d recency, 21d access freshness).
- Env var overrides in `config.ts`: `QDRANT_URL`, `QDRANT_API_KEY`, `OPENAI_API_KEY` (required), `EMBEDDING_MODEL`.

## Update Protocol

Update this file when adding memory tiers, changing the embedding model, modifying search strategies, or altering the consolidation pipeline.
