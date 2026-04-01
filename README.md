# DUSTIN

**Digital Utility System for Tracking, Intelligence & Notifications**

An autonomous AI co-worker that runs on its own server. Forked from [Phantom](https://github.com/ghostwright/phantom) v0.18.1 and migrated to managed cloud services.

---

## What It Does

DUSTIN is a personal AI assistant that lives on a dedicated VM, communicates via Telegram, remembers conversations across sessions, and gets better at your specific workflows over time through self-evolution.

Unlike disposable chat sessions, DUSTIN:

- **Remembers everything** — Three tiers of vector memory (episodic, semantic, procedural). Mention something on Monday, it uses it on Wednesday.
- **Evolves itself** — After every session, it extracts observations, proposes config changes, validates them through LLM judges, and applies improvements. Every version is stored and rollback-safe.
- **Creates its own tools** — Builds and registers MCP tools at runtime that persist across restarts and are available to external clients like Claude Code.
- **Runs 24/7** — Always on, even when your laptop is closed. Dashboards, APIs, and pages get public URLs you can share.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun (TypeScript) |
| Agent SDK | Claude Agent SDK (Opus 4.6) |
| Vector DB | Qdrant Cloud (managed) |
| Embeddings | OpenAI text-embedding-3-small (1536d) |
| State DB | Supabase (managed Postgres) |
| Channels | Telegram (primary), Email (Resend), Webhook |
| MCP | @modelcontextprotocol/sdk (Streamable HTTP) |
| Hosting | Hetzner VPS (Ubuntu 24.04, Docker) |
| CI/CD | GitHub Actions → GHCR → auto-deploy |

## Architecture

```
         External Clients (Claude Code, other agents)
                       |
             MCP (Streamable HTTP, Bearer auth)
                       |
+--------------------------------------------------+
|            DUSTIN (single Bun process)           |
|                                                  |
|  Channels          Agent Runtime                 |
|  Telegram          Claude SDK query()            |
|  Email (Resend)    Prompt Assembler              |
|  Webhook           base + role + evolved         |
|  CLI               + memory context              |
|                                                  |
|  Memory System     Self-Evolution Engine         |
|  Qdrant Cloud      6-step pipeline               |
|  OpenAI embeds     5-gate validation             |
|  3 collections     LLM judge (Sonnet 4.6)        |
|                                                  |
|  MCP Server        Role System                   |
|  Universal tools   YAML-first roles              |
|  + role tools      Onboarding flow               |
|  + dynamic tools   Evolution focus               |
+--------------------------------------------------+
         |                    |
   +-----+------+    +-------+-------+
   | Qdrant     |    | Supabase      |
   | Cloud      |    | (Postgres)    |
   +------------+    +---------------+
```

## Key Features

- **Persistent memory** — Episodic (session transcripts), semantic (accumulated facts with contradiction detection), and procedural (learned workflows). Hybrid search with dense vectors + BM25 sparse search.
- **Self-evolution** — Observe → Critique → Generate → Validate → Apply → Consolidate. Five validation gates (constitution, regression, size, drift, safety) with cross-model judge voting and minority veto.
- **Two-user model** — Owner and partner roles with distinct permissions for evolution and features.
- **Dynamic MCP tools** — Agent creates tools at runtime, registers them in Supabase, and exposes them via MCP to Claude Code and other agents.
- **Encrypted secrets** — AES-256-GCM encrypted credentials collected via secure magic-link forms. No plain-text secrets in config.
- **Conversation audit trail** — All messages stored in Supabase with full-text search for compliance and recall.

## Project Structure

```
src/
├── agent/          # Runtime, prompt assembly, hooks, cost tracking
├── channels/       # Telegram, Email, Webhook, CLI adapters
├── cli/            # CLI commands (start, init, doctor, token, status)
├── config/         # YAML loaders, Zod validation
├── core/           # HTTP server (Bun.serve), graceful shutdown
├── db/             # Supabase client, migrations
├── evolution/      # Self-improvement engine, validation, judges
├── mcp/            # MCP server, tools, auth, dynamic tools
├── memory/         # Qdrant client, 3-tier memory system
├── onboarding/     # First-run detection, user profiling
├── roles/          # Role registry, YAML definitions
├── scheduler/      # Cron-style job scheduling
├── secrets/        # Encrypted credential storage
├── audit/          # Conversation audit logging
└── index.ts        # Main orchestrator
```

## Quick Start

### Docker (recommended)

```bash
git clone https://github.com/icatel15/dustin-digital-utility-system-for-tracking-intelligence-and-notifications-.git
cd dustin-digital-utility-system-for-tracking-intelligence-and-notifications-
cp .env.example .env
# Edit .env — add ANTHROPIC_API_KEY, Telegram bot token, Supabase and Qdrant credentials
docker compose up -d
```

Health check: `http://localhost:3100/health`

### Local Development

```bash
bun install
bun run dev          # Start with --watch
bun test             # Run tests
bun run lint         # Biome linter
bun run typecheck    # tsc --noEmit
```

## Connect from Claude Code

Generate a token and add DUSTIN to your MCP config:

```bash
docker exec dustin bun run phantom token create --client claude-code --scope operator
```

```json
{
  "mcpServers": {
    "dustin": {
      "type": "streamableHttp",
      "url": "https://your-dustin-server/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN"
      }
    }
  }
}
```

## Current Status

- Live on Hetzner VPS, responding via Telegram
- All managed services connected (Qdrant Cloud, OpenAI embeddings, Supabase)
- Self-evolution running (LLM judges enabled)
- 965 tests passing
- CI/CD pipeline live: merge to main → auto-deploy via Docker + GHCR

See [docs/status/index.md](docs/status/index.md) for full project status and roadmap.

## Documentation

- [Getting Started](docs/guides/getting-started.md)
- [Architecture](docs/reference/architecture.md)
- [Tech Stack](docs/reference/tech-stack.md)
- [Schema](docs/reference/schema.md)
- [Conventions](docs/reference/conventions.md)

## License

Apache 2.0. See [LICENSE](LICENSE).

---

*Forked from [Phantom](https://github.com/ghostwright/phantom) by Ghostwright.*
