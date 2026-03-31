# Phase 5 — Web Dashboard

## Overview

A bundled React admin dashboard for DUSTIN, served from the same Bun server. Single-user (Woody only), authenticated via magic-link. Provides runtime configuration, monitoring, memory inspection, and operational control — replacing SSH for day-to-day admin tasks.

Polling-based data refresh. Model/config changes trigger automatic container self-restart.

## Sub-Phases

| Sub-Phase | Name | Scope |
|-----------|------|-------|
| 5a | Core Shell | React app scaffold, auth, admin API, config/model management, self-restart |
| 5b | Monitoring | Cost dashboard, telemetry, channel health, session browser |
| 5c | Memory & Evolution | Memory browser/editor, evolution inspector, domain knowledge viewer |
| 5d | Operations | Scheduled jobs UI, MCP tools manager, key rotation, env var management |

---

## Phase 5a — Core Shell

### Existing State

- `Bun.serve()` handles HTTP on port 3100 (`src/core/server.ts`)
- Routes: `/health`, `/mcp`, `/trigger`, `/webhook`, `/ui/*`
- Magic-link auth exists (`src/ui/session.ts`): 10-min magic links, 7-day session cookies
- `phantom_generate_login` MCP tool creates magic links
- Static files served from `public/` with path traversal protection
- Config loaded from `config/phantom.yaml` + env overrides (`src/config/loader.ts`)
- DaisyUI v5 + Tailwind v4 base template (`public/_base.html`)

### Changes

#### 1. React App Setup

Create a React SPA at `dashboard/`:

```
dashboard/
  src/
    main.tsx              — Entry point
    App.tsx               — Router, layout, auth guard
    api/
      client.ts           — Fetch wrapper for /api/admin/* (cookie auth)
    pages/
      Overview.tsx         — Health, uptime, channels, quick stats
      Config.tsx           — Model selector, effort, env vars, restart
      (remaining pages added in 5b-5d)
    components/
      Layout.tsx           — Navbar, sidebar, theme toggle
      StatusBadge.tsx      — Health status indicator
      ConfirmDialog.tsx    — Destructive action confirmation
    hooks/
      usePolling.ts        — Generic polling hook (configurable interval)
      useApi.ts            — Fetch + loading/error state
  index.html              — SPA entry point
  vite.config.ts          — Vite config (build output → public/dashboard/)
  tsconfig.json
  package.json
```

- **Build tool**: Vite (outputs static files to `public/dashboard/`)
- **Routing**: React Router (client-side, hash router to avoid server route conflicts)
- **Styling**: Tailwind v4 + DaisyUI v5 (matching existing design system)
- **No SSR** — pure SPA, API-driven

#### 2. Admin API Routes (`src/core/admin-api.ts`)

New module registered in `server.ts` under `/api/admin/*`. All routes require valid `phantom_session` cookie.

**Config endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/config` | Current runtime config (model, effort, port, role, domain) |
| `PATCH` | `/api/admin/config` | Update config fields (model, effort). Writes to `config/phantom.yaml` and `.env` |
| `GET` | `/api/admin/models` | Available model list (hardcoded: haiku, sonnet, opus with IDs) |
| `POST` | `/api/admin/restart` | Trigger container self-restart |

**Health/status endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/health` | Extended health (superset of `/health` with config details) |

**Auth**: Reuse existing `isValidSession()` from `src/ui/session.ts`. All `/api/admin/*` routes return 401 if no valid session cookie.

#### 3. Server Integration (`src/core/server.ts`)

- Add route delegation: requests matching `/api/admin/*` route to `handleAdminRequest()` from `src/core/admin-api.ts`
- Add route: `/dashboard` and `/dashboard/*` serve `public/dashboard/index.html` (SPA fallback)
- Static assets under `/dashboard/assets/*` served from `public/dashboard/assets/`

#### 4. Config Writer (`src/config/writer.ts`)

New module. Writes validated config changes back to `config/phantom.yaml`.

```typescript
export async function updateConfig(updates: Partial<ConfigUpdates>): Promise<void>

type ConfigUpdates = {
  model: string;
  effort: "low" | "medium" | "high" | "max";
};
```

- Reads current YAML, merges updates, validates with Zod schema, writes back
- Also updates `.env` `PHANTOM_MODEL` when model changes (so env and YAML stay in sync)
- Logs changes to stdout for audit trail

#### 5. Self-Restart (`src/core/restart.ts`)

New module. Triggers a graceful container restart.

```typescript
export async function selfRestart(): Promise<void>
```

- Sends `SIGTERM` to own process after a short delay (allows the HTTP response to complete)
- Docker's restart policy (`unless-stopped`) brings the container back with new config
- The restart endpoint returns `{ status: "restarting", message: "Container will restart in 2 seconds" }` before the process exits

#### 6. Dashboard Login Flow

- User asks DUSTIN (via Telegram) for a dashboard link
- DUSTIN calls `phantom_generate_login` which creates a magic link to `/dashboard`
- User clicks link, gets authenticated, session cookie set
- Subsequent visits within 7 days use the cookie (no re-auth needed)
- Dashboard shows login prompt with "Ask DUSTIN for a login link" message if unauthenticated

#### 7. Overview Page (`dashboard/src/pages/Overview.tsx`)

Landing page showing:
- Agent name, model, role, uptime
- Channel health (Telegram: connected/disconnected, future: Notion, Email)
- Memory health (Qdrant, embeddings)
- Evolution generation number
- Quick actions: restart, open config

Polls `/api/admin/health` every 30 seconds.

### Acceptance Criteria

- [ ] AC-5a.1: `bun run dashboard:build` produces static files in `public/dashboard/`
- [ ] AC-5a.2: `/dashboard` serves the React SPA with auth guard
- [ ] AC-5a.3: Unauthenticated requests to `/api/admin/*` return 401
- [ ] AC-5a.4: Authenticated requests to `/api/admin/config` return current model, effort, role
- [ ] AC-5a.5: `PATCH /api/admin/config` with `{ model: "claude-sonnet-4-6" }` updates `phantom.yaml` and `.env`
- [ ] AC-5a.6: `POST /api/admin/restart` triggers container self-restart within 5 seconds
- [ ] AC-5a.7: Overview page displays live health data (channels, memory, evolution)
- [ ] AC-5a.8: Config page allows model selection from dropdown and shows current value
- [ ] AC-5a.9: Dashboard is mobile-responsive (usable on phone screens)
- [ ] AC-5a.10: Light/dark theme toggle works, matching existing DaisyUI theme system

### Test Strategy

**Tier 1 (Unit):**
- Config writer: reads YAML, merges updates, validates, writes back
- Admin API route handlers: mock dependencies, verify responses
- Auth guard: valid/invalid/missing session cookies

**Tier 2 (Integration):**
- Full request cycle: magic-link → session cookie → API call → config file updated
- Restart endpoint: verify SIGTERM is scheduled (mock `process.kill`)
- Static file serving: `/dashboard` returns index.html, `/dashboard/assets/*` returns built assets

**Tier 4 (E2E — Playwright):**
- Login flow: unauthenticated → magic link → dashboard loads
- Config change: select new model → confirm → verify config file updated
- Overview: verify health data renders

---

## Phase 5b — Monitoring

### Existing State

- `CostTracker` records per-turn cost events to Supabase `cost_events` table
- `sessions` table tracks aggregated cost, token counts, turn count per session
- `conversation_messages` table stores full audit trail with full-text search
- Channel health available via provider functions in `server.ts`
- `/health` endpoint returns channel, memory, and evolution status

### Changes

#### 1. Cost API Endpoints (`src/core/admin-api.ts`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/costs/summary` | Aggregate costs by period (today, 7d, 30d, all-time) |
| `GET` | `/api/admin/costs/by-model` | Cost breakdown by model |
| `GET` | `/api/admin/costs/by-day` | Daily cost series (last 30 days) |
| `GET` | `/api/admin/costs/by-session` | Per-session costs (paginated) |

#### 2. Session API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/sessions` | Recent sessions (paginated, sortable) |
| `GET` | `/api/admin/sessions/:key` | Session detail (messages, cost, duration) |
| `GET` | `/api/admin/sessions/:key/messages` | Conversation messages for a session |

#### 3. Telemetry API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/telemetry` | Token usage, response times, error rates (aggregated) |

#### 4. Dashboard Pages

- **Cost Dashboard** (`pages/Costs.tsx`): Daily spend chart (ECharts), model breakdown, running totals, per-session cost table
- **Sessions** (`pages/Sessions.tsx`): Session list with search (full-text via `tsv` column), click-through to conversation view
- **Session Detail** (`pages/SessionDetail.tsx`): Message timeline (user/assistant/tool_use), cost per turn, duration
- **Telemetry** (`pages/Telemetry.tsx`): Token usage over time, average response time, error rate

### Acceptance Criteria

- [ ] AC-5b.1: Cost summary shows today, 7-day, 30-day, and all-time totals
- [ ] AC-5b.2: Daily cost chart renders last 30 days with ECharts
- [ ] AC-5b.3: Cost breakdown by model shows per-model spend
- [ ] AC-5b.4: Session list is paginated and searchable
- [ ] AC-5b.5: Session detail shows full conversation with role labels (user/assistant/tool)
- [ ] AC-5b.6: Telemetry page shows token usage and response time aggregates

### Test Strategy

**Tier 1:** API endpoints return correct aggregations from mock Supabase data
**Tier 2:** Full query cycle against real Supabase with seeded test data
**Tier 4:** Cost chart renders with sample data, session search returns results

---

## Phase 5c — Memory & Evolution

### Existing State

- `MemorySystem` with three stores: episodic, semantic, procedural (all in Qdrant)
- Working memory at `data/working-memory.md` (plain markdown, read/written by agent)
- Auto-memory at `/home/phantom/.claude/projects/-app/memory/` (Claude Code memory system)
- Evolution engine: 6-step pipeline, 5-gate validation, versioned in `config_versions` table
- Evolved config files in `phantom-config/`: constitution, persona, user-profile, domain-knowledge, strategies/*
- Currently at generation 21

### Changes

#### 1. Memory API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/memory/episodic` | Recent episodes (paginated, filterable by type/outcome) |
| `GET` | `/api/admin/memory/semantic` | Semantic facts (paginated, filterable by category) |
| `GET` | `/api/admin/memory/procedural` | Procedures (paginated, sortable by confidence/usage) |
| `GET` | `/api/admin/memory/search` | Cross-store semantic search (query param) |
| `GET` | `/api/admin/memory/stats` | Collection sizes, last write times |
| `GET` | `/api/admin/memory/working` | Read `data/working-memory.md` |
| `PUT` | `/api/admin/memory/working` | Write `data/working-memory.md` |

#### 2. Evolution API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/evolution/current` | Current evolved config (all sections) |
| `GET` | `/api/admin/evolution/history` | Version history from `config_versions` table |
| `GET` | `/api/admin/evolution/history/:version` | Specific version diff (changes, metrics snapshot) |
| `GET` | `/api/admin/evolution/metrics` | Current evolution metrics |

#### 3. Dashboard Pages

- **Memory Browser** (`pages/Memory.tsx`): Tabbed view (episodic/semantic/procedural), search across stores, detail panels showing full records
- **Working Memory Editor** (`pages/WorkingMemory.tsx`): Markdown editor for `data/working-memory.md` with save
- **Evolution Inspector** (`pages/Evolution.tsx`): Current generation, config sections (constitution, persona, user profile, domain knowledge, strategies), version history timeline, per-version diff view
- **Evolution Metrics** (embedded in Evolution page): Success rate, correction rate, sessions since consolidation

### Acceptance Criteria

- [ ] AC-5c.1: Memory browser shows episodic, semantic, and procedural entries
- [ ] AC-5c.2: Memory search returns results across all three stores
- [ ] AC-5c.3: Working memory editor loads, edits, and saves `data/working-memory.md`
- [ ] AC-5c.4: Evolution inspector shows current config sections with formatted markdown
- [ ] AC-5c.5: Evolution history shows version timeline with diffs
- [ ] AC-5c.6: Memory stats show collection sizes

### Test Strategy

**Tier 1:** API endpoints with mocked Qdrant/Supabase responses
**Tier 2:** Memory search against real Qdrant with seeded vectors; evolution history against Supabase
**Tier 4:** Memory browser renders entries, working memory editor saves and reloads

---

## Phase 5d — Operations

### Existing State

- `Scheduler` manages jobs in Supabase `scheduled_jobs` table (cron, interval, one-shot)
- Dynamic MCP tools registered at runtime, stored in Supabase `tools` table
- Env vars loaded from `.env` and `config/phantom.yaml`
- No key rotation mechanism exists

### Changes

#### 1. Scheduler API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/jobs` | All scheduled jobs |
| `GET` | `/api/admin/jobs/:id` | Job detail (with run history) |
| `POST` | `/api/admin/jobs` | Create a job |
| `PATCH` | `/api/admin/jobs/:id` | Update a job (enable/disable, change schedule) |
| `DELETE` | `/api/admin/jobs/:id` | Delete a job |
| `POST` | `/api/admin/jobs/:id/run` | Force-execute a job |

#### 2. MCP Tools API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/tools` | All dynamic MCP tools |
| `DELETE` | `/api/admin/tools/:name` | Unregister a tool |

#### 3. Environment API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/env` | List env var keys (values masked, showing only key names + redacted values) |
| `PATCH` | `/api/admin/env` | Update env var(s) in `.env` file. Requires restart to take effect. |

#### 4. Key Rotation Endpoint

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/admin/env/rotate` | Generate a new value for a rotatable key (e.g., `TRIGGER_SECRET`, `MCP_AUTH_TOKEN`). Updates `.env` and flags restart required. |

Only internal secrets (those generated by DUSTIN, not third-party API keys) are rotatable via the dashboard. Third-party keys (Anthropic, OpenAI, Qdrant, Telegram) must be updated manually via the env editor — the dashboard does not contact external services to rotate them.

#### 5. Dashboard Pages

- **Scheduled Jobs** (`pages/Jobs.tsx`): Job list with status indicators, enable/disable toggles, create/edit form, force-run button, delete with confirmation
- **MCP Tools** (`pages/Tools.tsx`): Dynamic tool list with descriptions, unregister with confirmation
- **Environment** (`pages/Environment.tsx`): Env var table (keys visible, values masked with reveal toggle), edit inline, rotate button for rotatable keys, restart banner when changes pending

### Acceptance Criteria

- [ ] AC-5d.1: Job list shows all scheduled jobs with status, schedule, last run info
- [ ] AC-5d.2: Jobs can be enabled/disabled via toggle
- [ ] AC-5d.3: Jobs can be created with name, schedule (cron/interval/one-shot), and task
- [ ] AC-5d.4: Force-run executes a job immediately and shows result
- [ ] AC-5d.5: MCP tools list shows dynamic tools with unregister action
- [ ] AC-5d.6: Env vars display with masked values, revealable on click
- [ ] AC-5d.7: Env var updates write to `.env` and show "restart required" banner
- [ ] AC-5d.8: Key rotation generates a new value and updates `.env`
- [ ] AC-5d.9: Delete/unregister actions require confirmation dialog

### Test Strategy

**Tier 1:** Job CRUD API handlers with mock Scheduler; env reader/writer with temp files
**Tier 2:** Full job lifecycle (create → list → execute → delete) against real Supabase
**Tier 4:** Job creation form submits and job appears in list; env var edit + restart flow

---

## MCP Tool Parity

All admin API endpoints should also be exposed as MCP tools (admin scope) so external clients can perform the same operations:

| MCP Tool | Admin API Equivalent |
|----------|---------------------|
| `phantom_admin_config` | `GET/PATCH /api/admin/config` |
| `phantom_admin_restart` | `POST /api/admin/restart` |
| `phantom_admin_costs` | `GET /api/admin/costs/*` |
| `phantom_admin_sessions` | `GET /api/admin/sessions` |
| `phantom_admin_memory` | `GET /api/admin/memory/*` |
| `phantom_admin_evolution` | `GET /api/admin/evolution/*` |
| `phantom_admin_jobs` | `GET/POST/PATCH/DELETE /api/admin/jobs` |
| `phantom_admin_env` | `GET/PATCH /api/admin/env` |

Implementation: Thin wrappers that call the same service functions as the REST handlers.

---

## Security Considerations

- All `/api/admin/*` routes require authenticated session (magic-link → cookie)
- Env var values are never logged or included in error responses
- The env editor shows masked values by default; reveal requires an explicit action
- Key rotation only applies to internally-generated secrets, not third-party API keys
- Self-restart has a confirmation step in the UI
- The admin API is only accessible on the same domain/port as DUSTIN (localhost:3100 in production, behind Caddy)

## Non-Goals (Explicitly Out of Scope)

- Multi-user access control (single user only)
- Real-time WebSocket/SSE updates (polling is sufficient)
- Editing evolved config directly (evolution engine manages this; dashboard is read-only for evolved config)
- Editing semantic/episodic/procedural memory entries (read-only browser; only working memory is editable)
- Log viewer (use SSH/docker logs for now)
- Backup/restore functionality
