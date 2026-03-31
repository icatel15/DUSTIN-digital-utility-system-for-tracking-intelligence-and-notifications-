# src/ui/ -- Web UI server for admin and authentication

Serves the Phantom web interface: login page, authenticated dashboard, static assets, SSE event stream, secret collection form routing, and agent-created pages. Mounted under the `/ui/` path prefix on the core HTTP server.

Universal rules are governed by the root `CLAUDE.md`.

## File Inventory

| File | Purpose |
| --- | --- |
| `serve.ts` | Main request router (`handleUiRequest`). Handles login, secret forms, static files, SSE, and auth enforcement. Configurable via `setSecretsDb`, `setSecretSavedCallback`, `setPublicDir` |
| `session.ts` | In-memory session and magic link management. `createSession`, `createBoundSession`, `consumeMagicLink`, `isValidSession`, `revokeAllSessions`. Sessions last 7 days; magic links expire in 10 minutes |
| `login-page.ts` | Server-rendered login page HTML. DaisyUI/Tailwind, dark/light theme, magic-link token input, animated ghost logo |
| `events.ts` | Pub/sub event system with SSE streaming. `subscribe`, `publish`, `createSSEResponse`. Used to push real-time updates (e.g., `page_updated`) to browser clients |
| `tools.ts` | MCP tool server with `phantom_create_page` (write HTML to `public/`) and `phantom_generate_login` (create magic link). Uses `@anthropic-ai/claude-agent-sdk` |

## Route Inventory

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/ui/login` | None | Login page |
| POST | `/ui/login` | None | Validate magic token, set session cookie |
| GET | `/ui/secrets/:requestId` | Magic link | Secret collection form (magic link is the auth) |
| POST | `/ui/api/secrets/:requestId` | Session (bound) | Save submitted secrets; session must be bound to the requestId |
| GET | `/ui/api/events` | Session | SSE event stream |
| GET | `/ui/phantom-logo.svg` | None | Public asset |
| GET | `/ui/*` | Session | Static files from `public/` directory |

## Auth Requirements

- **Magic-link authentication**: Agent generates a magic link via `phantom_generate_login`. User clicks the link or pastes the token. `consumeMagicLink()` exchanges the one-time token for a session.
- **Session cookies**: `phantom_session` cookie, HttpOnly, Secure, SameSite=Strict, 7-day max age.
- **Bound sessions**: Secret form sessions are scoped to a specific `requestId` via `createBoundSession()`. A generic session cannot access another request's secret form.
- **Unauthenticated HTML requests** redirect to `/ui/login`; API requests return 401.

## How the UI Server Integrates with the Core HTTP Server

`handleUiRequest(req)` is a standalone function that accepts a `Request` and returns a `Response`. The core HTTP server delegates any request with a `/ui/` prefix to this handler. Configuration is set via module-level setters:
- `setSecretsDb(db)` -- wires up the Supabase client for secret form handling
- `setSecretSavedCallback(fn)` -- callback invoked (non-blocking) when secrets are saved
- `setPublicDir(dir)` -- overrides the default `public/` directory for static files

## Static File Serving

- Files served from the `public/` directory (configurable via `setPublicDir`).
- Path traversal protection via `isPathSafe()` -- resolves paths and rejects `..` and null bytes.
- Directory requests fall back to `index.html` if present.

## Dependencies

- `@anthropic-ai/claude-agent-sdk` -- MCP tool server creation
- `zod` -- tool input validation
- `src/secrets/store.ts` and `src/secrets/form-page.ts` -- secret collection flow
- `src/ui/session.ts` -- session management (in-memory, no external store)
- Bun runtime (`Bun.file`, `Bun.write`) for file I/O

## Update Protocol

Update this file when adding new routes, changing auth patterns, modifying session management, or adding new MCP tools.
