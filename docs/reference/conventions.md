# Coding Conventions

TypeScript/Bun conventions for DUSTIN, derived from the Phantom codebase.

## Language & Runtime

- **Language**: TypeScript, strict mode (`"strict": true` in tsconfig.json)
- **Runtime**: Bun — no Node.js APIs unless Bun provides a compatible shim
- **Compilation**: None. Bun runs TypeScript directly.
- **Type hints**: Required on all function signatures (parameters and return types). Inferred types acceptable for local variables.

## Async Patterns

- `async`/`await` everywhere. No raw callbacks, no `.then()` chains.
- Top-level await is permitted (Bun supports it natively).
- Use `Promise.all()` for independent concurrent operations.
- Use `AbortController` for cancellable async work.

## Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Functions, variables | camelCase | `loadConfig`, `sessionId` |
| Types, interfaces, classes | PascalCase | `ChannelAdapter`, `EvolutionResult` |
| Constants | SCREAMING_SNAKE | `MAX_RETRIES`, `DEFAULT_MODEL` |
| Files, directories | kebab-case | `memory-store.ts`, `evolution-engine/` |
| Environment variables | SCREAMING_SNAKE | `QDRANT_URL`, `SUPABASE_KEY` |

## Import Ordering

1. Bun built-ins (`bun:test`, `bun:sqlite`, etc.)
2. Third-party packages (`@anthropic-ai/...`, `telegraf`, `zod`, etc.)
3. Local imports (relative paths: `./`, `../`)

Blank line between each group.

## Framework Patterns

- **Single process**: One Bun process runs the agent, HTTP server, and all channels.
- **HTTP**: `Bun.serve()` directly. No Express, Fastify, or Hono.
- **No classes for services**: Prefer plain functions and closures. Classes are acceptable for stateful adapters (channels, database clients).
- **Dependency injection**: Pass dependencies as function arguments, not via global singletons.

## Configuration

- YAML files validated with Zod schemas at load time.
- Environment variable substitution: `${VAR_NAME}` syntax in YAML values.
- Config is loaded once at startup and treated as immutable during runtime.
- Phantom-config (evolved config) is loaded separately and may change between sessions.

## Testing

- **Runner**: `bun test` (built-in test runner)
- **Pattern**: `describe` / `it` / `expect`
- **File naming**: `*.test.ts` colocated with source files, or in `__tests__/` directories
- **Mocks**: Module-level overrides via `mock.module()`. No Jest.
- **Assertions**: Bun's built-in `expect` matchers.
- **Seeded randomness**: Any test involving randomness must use fixed seeds.

## Linting & Formatting

- **Tool**: Biome (`biome.json` in repo root)
- **Run**: `bunx biome check --apply .` to lint and format
- **CI**: Biome check runs before tests

## Package Management

- **Manager**: Bun (`bun install`, `bun add`, `bun remove`)
- **Lockfile**: `bun.lock` (committed to repo)
- **Version pinning**: Exact versions in `package.json` (no `^` or `~`)

## Error Handling

- Fail fast at system boundaries (incoming API requests, external service responses, config loading).
- Graceful degradation internally (if one memory store is unavailable, continue with others).
- Structured error logging with context (source, operation, input summary).
- Never catch-and-swallow. Every error is logged and classified.
- Use typed error classes for distinct failure modes where downstream code needs to discriminate.
