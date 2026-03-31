# src/core/ — HTTP server and process lifecycle management

Universal rules (methodology, TDD, DFD, code style) are governed by the root `CLAUDE.md`.

## File Inventory

| File | Purpose |
| --- | --- |
| `server.ts` | `startServer` — creates the main `Bun.serve` HTTP server with routes for `/health`, `/mcp`, `/trigger`, `/webhook`, and `/ui` |
| `graceful.ts` | `onShutdown` / `installShutdownHandlers` — registers cleanup tasks and runs them in reverse order on SIGINT/SIGTERM |
| `__tests__/health-status.test.ts` | Tests for `/health` endpoint status logic |
| `__tests__/trigger-auth.test.ts` | Tests for `/trigger` authentication and request handling |

## Server Setup

- `startServer(config, startedAt)` calls `Bun.serve` on `config.port`.
- Routes are dispatched by `url.pathname` inside a single `fetch` handler.
- Health providers are injected via module-level setter functions (e.g., `setMemoryHealthProvider`, `setChannelHealthProvider`, `setOnboardingStatusProvider`).

## Route Summary

| Path | Method | Purpose |
| --- | --- | --- |
| `/health` | GET | Returns JSON with status, uptime, version, agent name, role, channel/memory health, evolution generation, onboarding status, and peer health |
| `/mcp` | * | Proxies to the MCP server if registered |
| `/trigger` | POST | Authenticated task execution — bearer token verified via timing-safe compare against `TRIGGER_SECRET` env var, with rate limiting and audit logging |
| `/webhook` | * | Delegated to a registered webhook handler |
| `/ui/*` | * | Delegated to `handleUiRequest` from `src/ui/serve.ts` |

## Trigger Endpoint Security

- Disabled (returns 404) when `TRIGGER_SECRET` is unset.
- Uses `timingSafeEqual` for bearer token comparison.
- Supports delivery allowlist filtering and audit logging with hashed task content (no raw task text in logs).

## Graceful Shutdown

- `onShutdown(name, fn)` registers async cleanup tasks.
- `installShutdownHandlers()` hooks SIGINT and SIGTERM.
- Tasks run in **reverse registration order** (LIFO). Errors are caught and logged per-task without aborting remaining tasks.
- Process exits with code 0 after all tasks complete.

## Port Configuration

The server port comes from `config.port` (the `PhantomConfig` object), not directly from an env var.

## Dependencies

- `src/agent/runtime.ts` — `AgentRuntime` type for trigger handling
- `src/channels/slack.ts` — `SlackChannel` type for trigger delivery
- `src/config/types.ts` — `PhantomConfig` for server configuration
- `src/mcp/` — `AuditLogger`, `RateLimiter`, `PhantomMcpServer` types
- `src/memory/types.ts` — `MemoryHealth` type for health endpoint
- `src/ui/serve.ts` — `handleUiRequest` for UI route delegation

## Update Protocol

Update this file when adding new HTTP routes, changing the shutdown sequence, modifying health status logic, or changing the trigger authentication mechanism.
