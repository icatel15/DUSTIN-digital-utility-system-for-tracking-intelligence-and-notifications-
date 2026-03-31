# DUSTIN — Digital Utility System for Tracking, Intelligence & Notifications

## What We're Building

DUSTIN is a personal AI assistant for me and my wife. Always-on, self-evolving, accessible via Telegram, email, and a web dashboard. It reads and writes my Notion workspace. It's accessible from Claude Code via MCP. It runs on its own dedicated VM where it can install software, spin up databases, build dashboards, create its own tools, and get measurably better over time. It is not a chatbot — it is a digital co-worker with its own computer.

Named after our dog.

## Starting Point

We're forking [ghostwright/phantom](https://github.com/ghostwright/phantom) (v0.17.0, Apache 2.0, TypeScript/Bun, 770 tests). Phantom is an AI co-worker framework built on the Claude Agent SDK that gives an agent its own VM with persistent memory, self-evolution, an MCP server, and dynamic tool creation. The codebase is well-structured, has good test coverage, and solves most of the hard infrastructure problems we need.

We're forking rather than building from scratch because ~70-75% of the architecture aligns with what we want. The core agent runtime, self-evolution pipeline, MCP server, credential encryption, Docker socket access for sibling container creation, and VM autonomy patterns are exactly what we need. The divergences are mostly swapping channels (Telegram not Slack), changing the data layer (managed services not co-located containers), and adding integrations Phantom doesn't have (Notion, two-user support).

## Architecture Decisions

These have been fully discussed and decided. Do not revisit or second-guess them.

### Data Layer: Qdrant Cloud + Supabase + External Embeddings

Phantom ships with Qdrant and Ollama as Docker containers co-located on the same VM. We're replacing this with managed services so that no critical data lives on the VPS — if the VM dies, we reprovision and reconnect with zero data loss.

- **Qdrant Cloud** (~$25/month managed) for all vector memory. Three collections: episodic (conversation history), semantic (facts, preferences, domain knowledge), procedural (workflows, learned patterns). This is Phantom's existing three-tier memory taxonomy, just pointed at a managed instance instead of a local container.
- **Supabase** (managed Postgres, free tier) for all structured data: config versions, user identity, Notion sync state, audit logs, tool registry, evolution observations. This replaces Phantom's SQLite (`data/phantom.db`).
- **OpenAI text-embedding-3-small** (or Voyage) for embedding generation. This replaces Phantom's local Ollama with nomic-embed-text. Small per-call cost, better quality.

The VPS becomes purely compute — the agent's playground. Disposable and rebuildable.

### Compute: Hetzner Cloud VPS

Full VM with root access, Docker, systemd. The agent needs to install packages, spin up services (databases, dashboards, APIs), expose them on public URLs, create Docker sibling containers, and schedule cron jobs. This rules out container platforms like Railway.

- Hetzner CX22 (2 vCPU, 4GB RAM, ~€4/month) or CX32 (4 vCPU, 8GB, ~€8/month)
- Ubuntu 24.04 LTS
- Caddy as reverse proxy with auto TLS via Let's Encrypt
- Custom domain
- Docker socket mounted so the agent can create sibling containers

### Channels: Telegram + Email + Web Dashboard

Phantom is Slack-first. We're swapping to Telegram as the primary channel. We chose Telegram over WhatsApp (which we both already use) because WhatsApp's Business API is expensive (~$15-25/month), has conversation-initiation restrictions (24-hour windows, template messages), and requires Meta approval. Telegram's Bot API is free, instant to set up, has the richest feature set (inline keyboards, file sharing, voice messages, groups), and Phantom already has a Telegram channel implementation to build on.

1. **Telegram** — primary interaction channel with three chat contexts:
   - **Shared group chat** (me + wife + bot) — household-level interactions: renovation updates, meal planning, shared tasks, decisions, things we both need to know about. Messages tagged as shared context.
   - **My DM with the bot** — individual stuff: blog pipeline, MTG deck research, personal projects, TRIBE thinking. Tagged to my user ID.
   - **Wife's DM with the bot** — her individual interactions. Tagged to her user ID.
   - The bot is in all three chats simultaneously. Each message carries both chat ID (which context) and user ID (who said it), so the agent always knows who said what and where.
   - Uses `grammy` or `telegraf` for the Telegram Bot API.
2. **Email** — agent has its own email address via Resend (Phantom already supports this). Can send reports, summaries, reminders. Can receive instructions via inbound email webhook.
3. **Web dashboard** — admin/observability panel, not a chat interface. Memory browser, evolution history, Notion sync status, tool registry, audit log, system health.

Slack is disabled but code is kept (might want it later). The agent also exposes an MCP server for Claude Code integration.

### Two-User Model

This is for me and my wife. Both interact with the bot via Telegram — in the shared group and in individual DMs. Both contribute to the agent's shared memory and evolution. Key requirements:

- Telegram user IDs mapped to internal user records in Supabase
- All memory operations tagged with the user who triggered them AND the chat context (group vs DM)
- Evolution observations tagged by user
- Shared semantic memory (the agent knows things about both of us and our shared context — home, renovation, cooking, etc.)
- Individual context (the agent knows my blog pipeline is mine, not my wife's)
- Only our two Telegram user IDs are authorised to interact with the bot (enforced in both group and DM contexts)
- The group chat is the primary channel for shared household decisions; DMs are for individual tasks and projects

### Notion Integration (bidirectional)

I use Notion daily as my primary organisational tool: personal task/project tracking, blog pipeline, home renovation project management, research and reference material, cooking/recipes/meal planning. The agent needs read/write access.

- **Notion → Agent memory:** Periodic sync job fetches configured Notion pages/databases, diffs against stored state, embeds changed content into the Qdrant semantic collection. Notion content tagged with `source: notion` and `page_id` in Qdrant payload. Sync state tracked in Supabase.
- **Agent → Notion:** The agent can create pages, update databases, and add blocks when instructed. Scoped to configured pages only. All writes logged to audit_log in Supabase.
- **Exclusion rules:** Config option to exclude specific pages/databases. No work-related content (J.P. Morgan) should be accessible to the agent.
- Uses `@notionhq/client` package and `NOTION_API_KEY` env var.

### Self-Evolution: Full Pipeline

This is a core feature, not optional. Keep Phantom's 6-step pipeline exactly as-is:

1. Observe — extract corrections, preferences, facts from conversations
2. Critique — compare session performance against current config
3. Generate — propose minimal, targeted config changes
4. Validate — 5 gates (constitution, regression, size, drift, safety) with cross-model LLM judges. Triple-judge voting with minority veto.
5. Apply — write approved changes, bump version
6. Consolidate — periodically compress observations into principles

Additions:
- Version history stored in Supabase (not SQLite)
- Weekly evolution summary sent via email — "here's what I learned this week"
- Evolution observations tagged by user (me vs wife)

### Security Model: Moderate Boundary

General personal info is fine. No work data (J.P. Morgan), no financial data, no sensitive documents.

- Agent runs on isolated infrastructure (not our laptops)
- Notion integration scoped to specific pages (exclude work-related databases)
- Credential encryption using AES-256-GCM (keep Phantom's existing implementation)
- Only two authorised Telegram user IDs can interact with the bot
- Audit log of all Notion writes, emails sent, tools created
- VPS hardened: UFW (ports 22, 80, 443 only), fail2ban, non-root container user

### MCP Server

Keep Phantom's existing MCP server implementation. I want to connect to this from Claude Code so I can query the agent's memory, trigger actions, and use any dynamic tools the agent has built. Token-based auth via streamable HTTP.

## What to Keep from Phantom (don't touch)

- Agent runtime (Bun process, prompt assembler, query() + hooks)
- Self-evolution engine (6-step pipeline, 5-gate validation, LLM judges)
- MCP server (streamable HTTP, token auth, dynamic tool registration)
- Dynamic tool creation (agent builds and registers its own tools, persists across restarts)
- Role system (YAML-first roles, onboarding flow)
- Credential encryption (AES-256-GCM, magic-link collection)
- Docker socket access (sibling container creation)
- Health endpoint (/health)
- Public file serving (/public for dashboards, pages, tools)
- CLI (phantom init, phantom start, phantom token create)

## Implementation Phases

### Phase 1: Data Layer Swap (2-3 days)

Replace co-located Qdrant + Ollama with Qdrant Cloud + Supabase + OpenAI embeddings.

1. Remove Qdrant and Ollama service blocks from docker-compose.yaml. Remove their volumes. Docker Compose should now only run the Phantom container itself.
2. Update the Qdrant client configuration to point to Qdrant Cloud (add `QDRANT_URL` for cloud endpoint, add `QDRANT_API_KEY`).
3. Replace all Ollama embedding calls with OpenAI `text-embedding-3-small` API calls. Add `OPENAI_API_KEY` env var. Update vector dimensions in Qdrant collection config if they differ from nomic-embed-text.
4. Add Supabase client (`@supabase/supabase-js`). Create Supabase tables: `users`, `config_versions`, `notion_sync_state`, `audit_log`, `tools`, `evolution_observations`. Migrate all SQLite reads/writes to Supabase.
5. Update `scripts/docker-entrypoint.sh` — remove Qdrant/Ollama readiness checks, replace with connection tests to Qdrant Cloud and Supabase.

**Critical risk:** If Phantom's memory module has raw Qdrant client calls scattered throughout the codebase (rather than behind an interface), Phase 1 will require building an abstraction layer first. Audit all Qdrant and SQLite references before starting.

**Reconnaissance first:** Before writing any code, grep the codebase for: `qdrant`, `QdrantClient`, `sqlite`, `phantom.db`, `data/`, `ollama`, `embed`, `nomic`. Map every reference. Understand the module boundaries.

**Test:** Agent boots, connects to Qdrant Cloud and Supabase, can store and retrieve memories, all existing tests pass (with updated mocks for managed services).

### Phase 2: Telegram Channel + Two-User Support (3-4 days)

1. Create or adapt `src/channels/telegram.ts` following Phantom's existing channel pattern (Phantom already has a Telegram channel, so this may be adaptation rather than a new build).
2. Support three chat contexts: shared group chat + two individual DMs. The bot joins all three. Each incoming message carries chat ID (group vs DM) and user ID (who sent it). Tag all memory operations with both.
3. Implement two-user identity: map Telegram user IDs to Supabase user records. Add `OWNER_TELEGRAM_USER_ID` and `PARTNER_TELEGRAM_USER_ID` env vars. Reject messages from any other user ID, including in the group chat.
4. Disable Slack channel via feature flag (don't delete the code).
5. Adapt onboarding flow from Slack DM to Telegram.

**Test:** Both users can message in the group and via DM. Memories are stored with correct user and chat context attribution. Unauthorised users are rejected. Agent can reference group context in a DM and vice versa.

### Phase 3: Notion Integration (3-4 days)

1. Create `src/integrations/notion.ts` with `@notionhq/client`.
2. Build periodic sync job: fetch configured pages → diff against `notion_sync_state` → embed changed content → upsert to Qdrant semantic collection → update sync state.
3. Register Notion write capabilities as agent tools (create page, update database, add block). Scope to configured pages only.
4. Implement exclusion rules (page IDs or title patterns to skip).
5. Log all Notion writes to `audit_log` in Supabase.

**Test:** Agent can answer questions about Notion content. Agent can create/update Notion pages when instructed. Excluded pages are not synced.

### Phase 4: Email Channel (2-3 days)

1. Outbound email: Phantom already supports Resend — configure with custom domain.
2. Inbound email: set up Resend webhook or Cloudflare Email Workers. Route incoming emails to agent as messages, matching sender against known users.
3. Scheduled reports: weekly evolution summary, configurable schedules for other reports.

**Test:** Agent sends email. Incoming email from authorised user triggers agent response.

### Phase 5: Web Dashboard (3-4 days)

1. Simple web app served from Phantom's existing HTTP server. Lightweight (Preact, htmx, or plain HTML + Tailwind). Auth via magic-link or password.
2. Views: memory browser (search episodic/semantic/procedural), evolution history (timeline, diffs, rollback), Notion sync status, tool registry, audit log, system health.
3. API endpoints extending Phantom's existing HTTP server, sourcing data from Supabase and Qdrant Cloud.

**Test:** Can log in, browse memories, view evolution history, see Notion sync status.

### Phase 6: Deployment & Hardening (2-3 days)

1. Provision Hetzner CX22/CX32. Ubuntu 24.04, Docker, Caddy, custom domain.
2. Production docker-compose: Phantom container only, Caddy as reverse proxy, Docker socket mounted, systemd service.
3. Security: UFW (22, 80, 443), fail2ban, non-root container, Telegram restricted to two user IDs.
4. Monitoring: health endpoint + UptimeRobot, error alerting via Telegram.

**Test:** Full system running on Hetzner, TLS, both users interact via Telegram, MCP accessible from Claude Code.

## Environment Variables (final .env)

```
# Required
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Qdrant Cloud
QDRANT_URL=https://xxx.cloud.qdrant.io:6333
QDRANT_API_KEY=...

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=...

# Telegram
TELEGRAM_BOT_TOKEN=...
OWNER_TELEGRAM_USER_ID=...
PARTNER_TELEGRAM_USER_ID=...

# Notion
NOTION_API_KEY=...
NOTION_SYNC_PAGES=page_id_1,page_id_2,...
NOTION_EXCLUDED_PAGES=page_id_x,page_id_y,...

# Identity
PHANTOM_NAME=dustin
PHANTOM_ROLE=base
PHANTOM_MODEL=claude-sonnet-4-6
PHANTOM_DOMAIN=...

# Email
RESEND_API_KEY=...
PHANTOM_EMAIL_DAILY_LIMIT=50

# Security
SECRET_ENCRYPTION_KEY=...  # 64-char hex, or auto-generated

# Docker
DOCKER_GID=988  # stat -c '%g' /var/run/docker.sock
```

## Cost Estimate

| Service | Monthly |
|---------|---------|
| Hetzner VPS (CX22) | ~€4 |
| Qdrant Cloud (starter) | ~$25 |
| Supabase (free tier) | $0 |
| OpenAI Embeddings | ~$1-3 |
| Anthropic API (agent + evolution) | ~$20-50 |
| Resend (free tier) | $0 |
| Domain | ~$1 |
| **Total** | **~$50-85/month** |

## Timeline

4 weeks to a production-ready system. Each phase produces a working, testable state.

## First Steps

1. Fork `ghostwright/phantom` to my GitHub
2. Clone locally, `bun install`, `bun test` — verify all 770 tests pass
3. Read through `src/` directory, map module boundaries
4. Grep for all Qdrant, SQLite, Ollama, and embedding references — understand coupling
5. Start Phase 1
