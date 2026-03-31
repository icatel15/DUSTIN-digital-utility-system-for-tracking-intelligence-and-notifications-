# src/audit/

Conversation audit trail — append-only log of every message (user, assistant, tool_use) processed by the Phantom agent.

## Components

- `conversation-logger.ts` — `ConversationLogger` class with `log()` and `query()` methods. Types (`MessageRole`, `ConversationMessageRow`, `ConversationQueryFilters`) are co-located.

## Storage

- Supabase table `conversation_messages` (migration: `supabase/migrations/20260331000004_conversation_messages.sql`)
- Includes a `tsvector` generated column + GIN index for full-text search via direct SQL

## Integration

- `ConversationLogger` is instantiated in `src/index.ts` and called fire-and-forget (no `await`) at three points in the `router.onMessage()` handler: user message, tool_use events, assistant response.
- An MCP tool `phantom_conversation_history` in `src/mcp/tools-universal.ts` exposes the query interface.

## Conventions

Universal rules are governed by the root `CLAUDE.md`. Update this file when adding new audit components or changing the table schema.
