# src/

Top-level source directory for the Phantom autonomous AI co-worker runtime. Contains the agent core, messaging channels, persistence, self-evolution, and supporting infrastructure.

Universal rules are governed by the root `CLAUDE.md`.

## Entry Point

`index.ts` is the main orchestrator. It boots the system in order: config -> roles -> database -> memory -> evolution -> agent runtime -> MCP server -> peer manager -> channels -> scheduler -> onboarding. Each subsystem is wired together via setter injection on the `AgentRuntime`. Inbound messages flow through `ChannelRouter.onMessage()` -> `AgentRuntime.handleMessage()`, with post-response hooks for memory consolidation, evolution, and audit logging. Graceful shutdown tears down in reverse order.

## Module Inventory

| Directory | Purpose |
|---|---|
| `agent/` | `AgentRuntime` (Claude Agent SDK `query()` wrapper), prompt assembly, session store, cost tracking, hooks (file tracker, dangerous command blocker) |
| `audit/` | Append-only conversation audit trail via `ConversationLogger` to Supabase (has its own CLAUDE.md) |
| `channels/` | Multi-channel messaging: Slack, Telegram, Email (IMAP/SMTP), Webhook, CLI. `ChannelRouter` dispatches inbound/outbound. Includes feedback reactions, progress streaming, Slack actions |
| `cli/` | `phantom` CLI entry point: `start`, `init`, `doctor`, `token`, `status` subcommands |
| `config/` | YAML config loading (`phantom.yaml`, `channels.yaml`, `memory.yaml`) with Zod validation and env var overrides |
| `core/` | HTTP health/status server (`Bun.serve`) and graceful shutdown handler |
| `db/` | Supabase client singleton, connectivity check, schema reference, test helpers |
| `evolution/` | Self-improvement pipeline: observe -> critique -> generate deltas -> validate (5 gates) -> apply -> consolidate (has its own CLAUDE.md) |
| `mcp/` | MCP server exposing tools/resources to external clients. Dynamic tool registry, peer-to-peer connections, auth, rate limiting, audit, SWE tools |
| `memory/` | Three-tier vector memory (episodic/semantic/procedural) via Qdrant + OpenAI embeddings. Context builder, consolidation, ranking (has its own CLAUDE.md) |
| `onboarding/` | First-run detection, owner profiling via Slack API, personalized intro message, onboarding state persistence |
| `roles/` | Role system: YAML-defined role templates loaded into `RoleRegistry`. Base role + specialized roles (e.g., SWE) with per-role prompts and tools |
| `scheduler/` | Cron-style job scheduler: persists jobs to Supabase, fires prompts through `AgentRuntime`, delivers results via Slack |
| `secrets/` | Encrypted credential storage: agent requests credentials via magic-link form, secrets encrypted at rest (AES-256-GCM), retrieved via MCP tools |
| `ui/` | Web UI serving: static files from `public/`, session auth (magic links), SSE event streaming, MCP tools for page creation |

## Folded-In Modules

**`email/tool.ts`** -- MCP tool server wrapping Resend API for outbound email. Daily send limit enforced in-memory. Only loaded when `RESEND_API_KEY` is set.

**`shared/patterns.ts`** -- Heuristic regex patterns for detecting user corrections, preferences, and domain facts in message text. Used by `evolution/` as fallback when LLM judges are unavailable.

**`utils/url-validator.ts`** -- SSRF prevention: validates callback URLs against private IPs, localhost, and cloud metadata endpoints. Sync check + async DNS resolution variant.

## Dependency Graph (key relationships)

- **`agent/`** depends on: `config/`, `db/`, `evolution/` (types), `memory/`, `roles/` (types)
- **`channels/`** depends on: `channels/types.ts` (internal); Slack/Telegram/Email are self-contained channel implementations
- **`core/server.ts`** depends on: `agent/`, `channels/`, `config/`, `mcp/`, `memory/`, `ui/`
- **`evolution/`** depends on: `shared/patterns.ts`, `config/` (via own config), file system (phantom-config/)
- **`mcp/`** depends on: `agent/`, `config/`, `db/`, `evolution/`, `memory/`
- **`memory/`** depends on: `config/` (types)
- **`onboarding/`** depends on: `channels/slack.ts`, `db/`, `roles/`
- **`scheduler/`** depends on: `agent/`, `channels/slack.ts`, `db/`
- **`secrets/`** depends on: `db/`
- **`ui/`** depends on: `db/`, `secrets/`

## Shared Patterns

- **MCP tool servers**: Modules exposing agent tools (`email/`, `scheduler/`, `secrets/`, `ui/`) follow the same pattern: export a `create*ToolServer()` function returning `McpSdkServerConfigWithInstance`. Wired as factories in `index.ts` via `runtime.setMcpServerFactories()`.
- **Error handling**: Console warnings with `[module]` prefix for non-fatal errors. Fatal errors in `main()` exit with code 1. Non-blocking operations use `.catch()` with logged warnings.
- **Config access**: YAML files loaded via Zod-validated loaders in `config/`. Env vars override YAML values.
- **Database**: All modules receive the Supabase client from `db/connection.ts` singleton, passed via constructor injection.

## Update Protocol

Update this file when adding or removing subdirectories, changing the boot sequence in `index.ts`, or altering cross-module dependency relationships.
