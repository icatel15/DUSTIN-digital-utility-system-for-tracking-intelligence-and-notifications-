# Phase 7 — Continuous Context Management

**Status**: Approved (design questions resolved 2026-03-31)
**Created**: 2026-03-31

## Problem

The current context model is all-or-nothing:

- **Within a session**: the Claude Agent SDK loads the entire conversation history via `persistSession: true` + `resume`. A 35-turn conversation sends 100K+ input tokens per message — most of which is stale early-conversation context.
- **Across sessions**: only Qdrant summaries (episodes, semantic facts, procedures). Verbatim recall is lost.
- **Session boundaries are passive**: 24-hour inactivity timeout or container restart. No topic detection, no explicit end signal. A morning conversation and an evening conversation share one session.

This creates two problems:
1. **Cost** — input tokens grow linearly with conversation length. Long conversations are disproportionately expensive.
2. **Quality** — the model's attention is diluted across stale context instead of focused on what matters now.

## Proposed Solution: Tiered Context with Continuous Checkpointing

Replace the current "full history in SDK session" model with a three-tier context system:

### Tier 1 — Hot (verbatim, last ~5 turns)
The most recent turns, kept as full messages. This is the active working context — what the model needs to maintain conversational coherence.

### Tier 2 — Warm-near (detailed summary of recent evicted turns)
A detailed summary covering the most recently evicted window (~10-15 turns). Captures open threads, recent decisions, and working context that just left the hot window. ~800 tokens.

### Tier 3 — Warm-far (compressed summary of earlier conversation)
A compressed summary of everything older than warm-near. Key decisions, topic overview, user preferences. As warm-near checkpoints fire, the previous warm-near gets folded into warm-far via re-summarization. ~400 tokens. This tier slowly compresses an ever-growing history while staying bounded in size.

### Tier 4 — Cold (Qdrant memory)
Episodes, semantic facts, and procedures from past conversations. Retrieved via semantic search against the current query. Already exists today via `MemoryContextBuilder`.

### Tier 5 — Archive (on-demand via MCP tool)
Full verbatim history in the `conversation_messages` table. The model can query this via `phantom_conversation_history` when it needs exact recall of something specific. Already deployed.

## Context Window at Turn 30

### Current (no change)
```
System prompt (9 layers)              ~15K tokens
Qdrant memory context                 ~10K tokens
Full conversation history (30 turns)  ~80-100K tokens
Current message                       ~200 tokens
────────────────────────────────────────────────
Total                                 ~105-125K tokens
```

### Proposed
```
System prompt (9 layers)              ~15K tokens
Qdrant memory context                 ~10K tokens
Warm-far summary (turns 1-15)         ~400 tokens
Warm-near summary (turns 16-25)       ~800 tokens
Hot window (turns 26-30, verbatim)    ~3-5K tokens
Current message                       ~200 tokens
────────────────────────────────────────────────
Total                                 ~30-32K tokens
```

**~75% reduction in input tokens per message in long conversations.**

## Checkpoint Mechanics

### When to checkpoint

**Trigger**: When the hot window exceeds N turns (default: 10). This is a token-budget-aware check — the actual trigger should be when hot window content exceeds a configurable token threshold (e.g., 15K tokens), not a fixed turn count, since some turns are much larger than others (e.g., tool-heavy turns with long outputs).

### What happens at a checkpoint

```
Hot window exceeds threshold
    │
    ├─ 1. Generate checkpoint summary
    │     Input: current warm summary + oldest hot turns being evicted
    │     Output: updated "story so far" (~500-800 tokens)
    │     Model: same model (inline) or cheaper model (async)
    │
    ├─ 2. Write mini-episode to Qdrant
    │     The evicted turns become an episodic memory entry
    │     with extracted facts — available for future sessions
    │
    ├─ 3. Rotate SDK session
    │     End current SDK session
    │     Start new SDK session with:
    │       - Same system prompt
    │       - Warm summary injected as context
    │       - Qdrant memory retrieval (standard path)
    │       - Hot window (retained recent turns)
    │
    └─ 4. Update session metadata
          Store checkpoint state in Supabase
          (which turns are summarized, summary content, SDK session ID)
```

### Checkpoint summary generation

The summary is not a generic "summarize this conversation" — it's structured to preserve what the model needs:

```
## Conversation Context (turns 1-25)

**Topic**: [what we're working on]
**Key decisions**: [what was agreed]
**Open threads**: [unresolved questions or pending actions]
**User preferences expressed**: [any corrections or stated preferences]
**Current state**: [where we left off]
```

This format gives the model orientation without verbatim bulk.

### SDK session rotation

The Claude Agent SDK's `persistSession` stores conversation state to disk. When we rotate:

1. The old SDK session is abandoned (its session files can be cleaned up)
2. A new SDK session is created (no `resume`)
3. Warm-far and warm-near summaries are injected into the system prompt's `append` section
4. The hot window turns are included as a structured "recent conversation" block in the system prompt (not replayed as synthetic messages)

This means the model sees: system prompt + warm-far + warm-near + hot block + current message. Clean and bounded.

## Integration with Existing Systems

### Prompt assembler (`src/agent/prompt-assembler.ts`)

Add two new layers for the warm summaries, inserted after the memory context:

```
Layer 9:  Memory context (Qdrant recall — cold tier)
Layer 10: Warm-far summary (compressed earlier conversation)
Layer 11: Warm-near summary (detailed recent evicted turns)
Layer 12: Hot window (verbatim recent turns as structured block)
```

The warm summary is only present when a checkpoint has occurred. For the first N turns of a conversation, there is no warm summary — the SDK session handles everything as it does today.

### Memory consolidation (`src/memory/consolidation.ts`)

Currently runs after every message response. With continuous checkpointing:

- **Checkpoint events** replace session-end consolidation as the primary memory write path
- Each checkpoint writes a mini-episode to Qdrant covering the evicted turns
- The per-message consolidation can be simplified or removed — checkpoints handle it
- The evolution pipeline (`afterSession`) continues to run per-message for observation extraction

### Session store (`src/agent/session-store.ts`)

Needs new fields to track checkpoint state:

- `checkpoint_count`: how many checkpoints have occurred
- `warm_summary`: the current warm summary text (or a reference to it)
- `hot_window_start_turn`: which turn number the hot window begins at

Alternatively, checkpoint state could live in a new `conversation_checkpoints` table to keep the sessions table lean.

### conversation_messages table

Already stores every message. The checkpoint process reads from this table to build the summary input — the turns being evicted from the hot window are fetched verbatim from `conversation_messages` rather than from in-memory state. This makes checkpointing resilient to container restarts.

### In-memory conversationMessages Map (`src/index.ts`)

Currently accumulates all turns in-memory for consolidation. With continuous checkpointing, this Map is no longer the source of truth — `conversation_messages` in Supabase is. The Map can be replaced with a bounded buffer (last N turns only), or removed entirely in favor of querying the audit trail.

## Design Decisions (resolved 2026-03-31)

### D-7.01: Checkpoint summary model
**Decision**: Same model, async after response delivery (option c). Non-blocking to user. If the user sends another message before the summary is ready, fall back to raw evicted turns.
**Note**: The summary model should be a user-configurable setting (Phase 5 — Web Dashboard).

### D-7.02: Hot window size
**Decision**: Token budget (max ~20K tokens, minimum 5 turns). Adapts to conversation density — prevents a few huge tool-output turns from consuming the entire budget while ensuring at least 5 turns are always retained.

### D-7.03: Warm summary accumulation
**Decision**: Two-level warm summaries with re-summarization.
- **Warm-near** (~800 tokens): detailed summary of the most recently evicted window (~10-15 turns). Generated at each checkpoint.
- **Warm-far** (~400 tokens): compressed summary of all earlier conversation. When a new checkpoint fires, the previous warm-near is folded into warm-far via re-summarization.
- This creates a slowly extending window: recent evicted turns get detailed coverage, older turns get progressively compressed, total warm budget stays bounded (~1200 tokens).

### D-7.04: Hot turns after SDK rotation
**Decision**: Include as a structured "recent conversation" block in the system prompt (option b). Replaying tool calls as synthetic SDK messages is fragile and may not be supported. A structured block is cleaner and more predictable.

### D-7.05: Checkpoint persistence
**Decision**: New `conversation_checkpoints` table. Checkpoints are append-only events with their own lifecycle. Keeps the sessions table lean and provides a history of all summaries (useful for debugging and evolution).

### D-7.06: Container restart recovery
**Decision**: Reconstruct context entirely from Supabase state. On restart, load the latest checkpoint summary from `conversation_checkpoints`, fetch the last N messages from `conversation_messages` as the hot window, and start a new SDK session. The Docker volume becomes a performance optimization, not a requirement.

## Deliverables

- [ ] Phase doc approved (this document)
- [ ] `conversation_checkpoints` table migration
- [ ] Checkpoint manager module (`src/context/checkpoint-manager.ts`)
- [ ] Checkpoint summary generator (LLM-based summarization)
- [ ] Warm summary injection in prompt assembler (layer 10)
- [ ] SDK session rotation logic in runtime
- [ ] Hot window management (token-budget-aware eviction)
- [ ] Container restart recovery from Supabase state
- [ ] Update memory consolidation to use checkpoint events
- [ ] Remove/simplify in-memory `conversationMessages` Map
- [ ] Configuration: hot window token budget, checkpoint trigger threshold
- [ ] Tests: checkpoint trigger, summary generation, session rotation, recovery
- [ ] Update `docs/reference/architecture.md` and `docs/guides/memory.md`

## Acceptance Criteria

1. A 30-turn conversation uses <35K input tokens per message (vs. 100K+ today)
2. The model maintains conversational coherence across checkpoint boundaries
3. `phantom_conversation_history` MCP tool provides full verbatim recall on demand
4. Container restart mid-conversation recovers context from Supabase without data loss
5. Checkpoint summaries are written to Qdrant as mini-episodes for cross-session memory
6. No regression in response quality for conversations under 10 turns (no checkpointing occurs)
7. Checkpoint overhead (summary generation) adds <3s latency and is non-blocking to response delivery
