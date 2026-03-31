# src/mcp/ — MCP Server Module

Exposes the Phantom agent as a Model Context Protocol (MCP) server over HTTP, providing tools, resources, authentication, rate limiting, and audit logging.

Universal rules are governed by the root `CLAUDE.md`.

## Module Inventory

| File | Responsibility |
|---|---|
| `server.ts` | `PhantomMcpServer` — top-level orchestrator. Wires auth, rate limiter, audit, transport, tools, and resources. Entry point: `PhantomMcpServer.create()`. |
| `transport.ts` | `McpTransportManager` — manages per-client HTTP sessions using `WebStandardStreamableHTTPServerTransport`. Handles session creation, session-to-client binding, scope checks, and stale session cleanup. |
| `auth.ts` | `AuthMiddleware` — Bearer token authentication via SHA-256 hashed tokens. Exports `TOOL_SCOPES` map and `getRequiredScope()`. Scope hierarchy: `admin` > `operator` > `read`. |
| `config.ts` | `loadMcpConfig()` — loads `config/mcp.yaml` (Zod-validated). Auto-generates default config with random tokens on first run. Exports `hashToken` (async) and `hashTokenSync` (Bun-specific). |
| `rate-limiter.ts` | `RateLimiter` — token-bucket rate limiter per client. Configured via `requests_per_minute` and `burst` from MCP config. |
| `audit.ts` | `AuditLogger` — writes every MCP request to the `mcp_audit` Supabase table. Logs client, method, tool/resource, duration, cost, and status. |
| `types.ts` | Shared types: `McpScope`, `TokenConfig`, `RateLimitConfig`, `McpConfig`, `AuthResult`, `AuditEntry`, `TaskRow`. |
| `tools-universal.ts` | 9 tools registered for all roles: `phantom_status`, `phantom_config`, `phantom_metrics`, `phantom_history`, `phantom_memory_query`, `phantom_ask`, `phantom_task_create`, `phantom_task_status`, `phantom_conversation_history`. Exports `ToolDependencies` type. |
| `tools-swe.ts` | 6 role-specific tools for `swe` role: `phantom_codebase_query`, `phantom_pr_status`, `phantom_ci_status`, `phantom_review_request`, `phantom_deploy_status`, `phantom_repo_info`. |
| `tools-dynamic.ts` | 3 management tools: `phantom_register_tool`, `phantom_unregister_tool`, `phantom_list_dynamic_tools`. |
| `dynamic-tools.ts` | `DynamicToolRegistry` — CRUD for user-defined tools persisted in the `dynamic_tools` Supabase table. Builds Zod schemas from simple type maps. |
| `dynamic-handlers.ts` | `executeDynamicHandler()` — runs dynamic tool handlers as subprocesses (`bash -c` for shell, `bun run` for script). Uses `buildSafeEnv()` to strip secrets; input passed via `TOOL_INPUT` env var. |
| `resources.ts` | 10 MCP resources under `phantom://` URIs: health, identity, config/current, config/changelog, tasks/active, tasks/completed, metrics/summary, metrics/cost/{period}, memory/recent, memory/domain/{topic}. |
| `peers.ts` | `PeerManager` — loads peer Phantom instances from `config/phantom.yaml` `peers` section. `checkPeerHealth()` and `checkAllPeerHealth()` hit each peer's `/health` endpoint. |
| `peer-health.ts` | `PeerHealthMonitor` — periodic health check loop (default 60s interval) for all registered peers. |

## Tool Registration Order

In `server.ts#createMcpServer()`:
1. Universal tools (`tools-universal.ts`)
2. Role-specific tools (`tools-swe.ts` for `swe` role)
3. Dynamic tool management tools (`tools-dynamic.ts`)
4. All persisted dynamic tools (`dynamic-tools.ts#registerAllOnServer`)
5. Resources (`resources.ts`)

## Authentication — 3 Scopes

- **read** — status, config, metrics, history, memory queries, dynamic tool listing
- **operator** — `phantom_ask`, `phantom_task_create`, `phantom_review_request` (implies read)
- **admin** — `phantom_register_tool`, `phantom_unregister_tool`, unknown/dynamic tools (implies operator + read)

Scope map lives in `auth.ts#TOOL_SCOPES`. Unknown tools default to `admin`.

## How to Add a New Tool

1. Define the tool function in the appropriate file (`tools-universal.ts` for all roles, `tools-swe.ts` for SWE-only, or a new `tools-<role>.ts`).
2. Call `server.registerTool(name, { description, inputSchema: z.object({...}) }, handler)`.
3. Add the tool name and required scope to `TOOL_SCOPES` in `auth.ts`.
4. If adding a new role file, register it in the `roleToolMap` in `server.ts#registerRoleTools()`.
5. Add tests in `__tests__/`.

## Dependencies

- `@modelcontextprotocol/sdk` — MCP server, transport, and types
- `zod` — input validation for all tools and config
- `yaml` — MCP config file parsing
- `../agent/runtime.ts` — `AgentRuntime` for `phantom_ask` and `phantom_review_request`
- `../db/connection.ts` — Supabase client for audit, tasks, costs, dynamic tools
- `../memory/system.ts` — memory recall for query tools
- `../evolution/engine.ts` — evolved config and metrics
- `../audit/conversation-logger.ts` — conversation history queries

## Update Protocol

Update this file when adding/removing tools, resources, or scopes, when changing the authentication model, or when modifying the transport or session lifecycle.
