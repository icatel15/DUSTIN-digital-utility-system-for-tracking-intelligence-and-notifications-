# Tech Stack

Layer-to-technology mapping for DUSTIN. The project is forked from Phantom v0.18.1 and progressively migrates to managed services.

## Current (Phantom Baseline)

| Layer | Technology | Notes |
|-------|-----------|-------|
| Runtime | Bun (TypeScript, no compilation) | Single-process, no bundler |
| Agent SDK | @anthropic-ai/claude-agent-sdk (Opus 4.6) | Claude as core reasoning engine |
| Vector DB | Qdrant (local Docker container) | Episodic, semantic, procedural collections |
| Embeddings | Ollama (nomic-embed-text, 768d) | Local inference, no API costs |
| State DB | SQLite (Bun built-in) | File-based, zero-config |
| Channels | Slack Bolt, Telegraf, ImapFlow, Nodemailer | Multi-channel messaging |
| Config | YAML + Zod validation | `${VAR}` env substitution |
| MCP | @modelcontextprotocol/sdk (Streamable HTTP) | External client connectivity |
| Process mgmt | Docker (was systemd) | Container lifecycle management |

## Target (DUSTIN)

| Layer | Technology | Notes |
|-------|-----------|-------|
| Runtime | Bun (TypeScript) | No change from baseline |
| Agent SDK | @anthropic-ai/claude-agent-sdk | No change from baseline |
| Vector DB | Qdrant Cloud (managed, ~$25/mo) | Removes local Docker dependency |
| Embeddings | OpenAI text-embedding-3-small (1536d) | Dimension upgrade from 768 to 1536 |
| State DB | Supabase (managed Postgres, free tier) | Replaces SQLite for durability and remote access |
| Channels | Telegraf (primary), Resend (email), Webhook | Drops Slack, uses Resend instead of SMTP |
| Config | YAML + Zod validation | No change from baseline |
| MCP | @modelcontextprotocol/sdk (Streamable HTTP) | No change from baseline |
| Hosting | Hetzner CX22/CX32 VPS, Ubuntu 24.04, Docker | Containerized deployment |
| CI/CD | GitHub Actions + GHCR | Auto-deploy on merge to main |
| Container Registry | ghcr.io/icatel15/dustin | Private GHCR image |
| Notion | @notionhq/client (bidirectional sync) | New integration, not in Phantom |

## Migration Path

Phase 1 replaced the data layer: Qdrant local → Qdrant Cloud, Ollama → OpenAI embeddings, SQLite → Supabase. Phase 2 added Telegram. Phase 6 replaced manual scp + systemd deployment with Docker + CI/CD auto-deploy via GHCR.
