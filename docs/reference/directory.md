# Project Directory

Structure map for DUSTIN. Based on Phantom v0.18.1 layout.

## Top-Level Structure

```
├── src/                  — Application source code
│   ├── agent/            — Runtime, prompt assembler, hooks, cost tracking
│   ├── channels/         — Slack, Telegram, Email, Webhook, CLI adapters
│   ├── cli/              — CLI commands (init, start, doctor, token, status)
│   ├── config/           — YAML config loaders, Zod schemas
│   ├── core/             — HTTP server (Bun.serve), graceful shutdown
│   ├── db/               — SQLite connection, migrations (→ Supabase in Phase 1)
│   ├── evolution/        — Self-evolution engine, reflection, validation, judges
│   ├── mcp/              — MCP server, tools, auth, transport, dynamic tools, peers
│   ├── memory/           — Qdrant client, episodic/semantic/procedural stores
│   ├── onboarding/       — First-run detection, state, prompt injection
│   ├── roles/            — Role types, loader, registry
│   └── shared/           — Shared patterns and utilities
├── config/               — Runtime configuration files
│   ├── phantom.yaml      — Main configuration (agent model, persona, memory settings)
│   ├── channels.yaml     — Channel configuration (env var substitution)
│   ├── mcp.yaml          — MCP auth tokens
│   └── roles/            — Role YAML definitions
├── phantom-config/       — Evolved config (grows over time via self-evolution)
├── docs/                 — Documentation (see subdirectory breakdown below)
│   ├── specs/            — Feature specifications (what to build)
│   ├── guides/           — How-to guides (how to do things)
│   ├── reference/        — Lookup material (facts about the system)
│   ├── status/           — Project tracking (phase progress, decisions)
│   ├── archive/          — Superseded docs (kept for historical reference)
│   └── assets/           — Images, SVGs, GIFs
├── public/               — Publicly served files (dashboards, pages, tools)
├── scripts/              — Docker entrypoint, deploy scripts, VPS migration
├── .github/workflows/    — CI/CD pipelines (ci.yml, deploy.yml, release.yml)
├── docker-compose.yaml   — Local dev container orchestration (builds from source)
├── docker-compose.user.yaml — Production compose (pulls from GHCR)
├── biome.json            — Linter/formatter configuration
├── tsconfig.json         — TypeScript configuration (strict mode)
├── package.json          — Dependencies and scripts
└── bun.lock              — Bun lockfile
```

## Entry Points

| File | Purpose |
|------|---------|
| `src/index.ts` | Main application entry point |
| `src/cli/main.ts` | CLI entry point (phantom init, start, doctor, etc.) |
| `src/core/server.ts` | HTTP server setup (Bun.serve) |

## Directories Receiving CLAUDE.md Files

The following directories have or will receive subfolder CLAUDE.md files:

- `docs/` — Documentation taxonomy and cross-reference conventions
- `src/` — Overall source conventions and module boundaries
- `src/agent/` — Prompt assembly, hooks, session lifecycle
- `src/channels/` — Channel adapter interface and implementations
- `src/config/` — Config loading, Zod schema conventions
- `src/db/` — Database client, migration process (significant change in Phase 1)
- `src/evolution/` — Evolution pipeline, validation gates, judge system
- `src/mcp/` — MCP server, tool registration, auth
- `src/memory/` — Memory stores, embedding pipeline (significant change in Phase 1)
- `config/` — YAML configuration conventions and env var substitution

Deeper directories will receive CLAUDE.md files only when they develop distinct conventions per the depth rule in the root CLAUDE.md.
