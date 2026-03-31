# src/agent/ -- Agent runtime, prompt assembly, session management, and cost tracking

Universal rules are governed by the root `CLAUDE.md`.

## Service Inventory

| File | Responsibility |
| --- | --- |
| `runtime.ts` | `AgentRuntime` class -- orchestrates the full message lifecycle: session lookup/creation, prompt assembly, SDK query execution (with resume support), event streaming, cost recording, and concurrency guard (one query per session key at a time). |
| `prompt-assembler.ts` | `assemblePrompt()` builds the full system prompt appended to the Claude Code preset. Sections are ordered: identity, environment, security boundaries, role template, onboarding, evolved config (constitution, persona, domain knowledge, strategies), instructions, working memory file, and memory context from Qdrant. |
| `session-store.ts` | `SessionStore` -- CRUD for the `sessions` table via Supabase. Tracks `sdk_session_id` for SDK resume, auto-expires sessions stale for >24 hours, upserts on conflict to reactivate expired rows. |
| `cost-tracker.ts` | `CostTracker` -- inserts per-turn rows into `cost_events` and increments running totals on the `sessions` row (read-then-update pattern because Supabase lacks `SET col = col + ?`). |
| `hooks.ts` | SDK hook factories. `createFileTracker()` records file paths touched by Edit/Write tools (PostToolUse). `createDangerousCommandBlocker()` blocks destructive shell commands via regex (PreToolUse) -- defense-in-depth, not a security boundary. |
| `events.ts` | Shared types: `AgentCost`, `AgentEvent`, `AgentResponse`, `AgentStopReason`, and `emptyCost()` factory. |
| `in-process-tools.ts` | `createInProcessToolServer()` builds an in-process SDK MCP server exposing `phantom_register_tool`, `phantom_unregister_tool`, and `phantom_list_dynamic_tools` backed by `DynamicToolRegistry`. |

## Dependencies

- **`@anthropic-ai/claude-agent-sdk`** -- `query()` for agent execution, `createSdkMcpServer` / `tool` for in-process MCP tools, hook types.
- **`../db/connection.ts`** (`SupabaseClient`) -- all persistence flows through Supabase.
- **`../config/types.ts`** (`PhantomConfig`) -- model, timeout, effort, budget, name, domain, role.
- **`../evolution/types.ts`** (`EvolvedConfig`) -- constitution, persona, user profile, domain knowledge, strategies.
- **`../roles/types.ts`** (`RoleTemplate`) -- role-specific system prompt section.
- **`../memory/context-builder.ts`** (`MemoryContextBuilder`) -- retrieves relevant memories from Qdrant per query.
- **`../mcp/dynamic-tools.ts`** (`DynamicToolRegistry`) -- runtime tool registration storage.
- **Node fs** -- `prompt-assembler.ts` reads `data/working-memory.md` from disk.

## Key Business Rules

1. **Concurrency guard** -- `AgentRuntime.activeSessions` prevents parallel queries on the same `channelId:conversationId` key. A second message returns a "still working" response immediately.
2. **Session resume** -- if an active session has a stored `sdk_session_id`, the SDK query uses `resume`. On "No conversation found" errors (stale session after deploy), the session ID is cleared and the query retries without resume.
3. **Prompt ordering matters** -- sections are appended in a fixed order so the SDK's cache-friendly prompt prefix stays stable across turns.
4. **Working memory truncation** -- if `data/working-memory.md` exceeds 75 lines, it is truncated (first 3 + last 70 lines) with a compaction warning injected into the prompt.
5. **Timeout** -- configurable via `config.timeout_minutes` (default 240 min). Uses `AbortController` to cancel the SDK query stream.

## Error Handling

- SDK query errors are caught, logged, and returned as `"Error: ..."` text in the `AgentResponse`.
- Stale session errors trigger one automatic retry without resume.
- Memory context builder failures are swallowed silently (agent continues without memory).
- Cost tracking and session touch run in the `finally` block to ensure recording even on error.

## Update Protocol

Update this file when:
- Adding new files to `src/agent/`.
- Changing the prompt section order or adding new prompt sections.
- Modifying session lifecycle (staleness, resume, concurrency).
- Adding new SDK hooks or in-process tools.
