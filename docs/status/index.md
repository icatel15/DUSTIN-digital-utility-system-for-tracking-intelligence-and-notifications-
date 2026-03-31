# DUSTIN — Master Status

**Read this file at the start of every session.**

## Project

DUSTIN (Digital Utility System for Tracking, Intelligence & Notifications)

## Current Phase

**Phase 6 — CI/CD Pipeline & Deployment Hardening** (complete)

## Current State

- DUSTIN live on Hetzner VPS (178.104.134.128), responding via Telegram (@Dustin_CWBot)
- Telegram two-user mode active (Woody = owner, Tash = partner pending ID)
- All managed services connected: Qdrant Cloud, OpenAI embeddings, Supabase
- Self-evolution running (generation 5, LLM judges enabled)
- 804 tests passing
- CI/CD pipeline live: merge to main → auto-deploy via Docker + GHCR
- Running via Docker on VPS (migrated from systemd 2026-03-31)

## Active Phase File

`docs/status/phase-6.md`

## Phase Roadmap

| Phase | Name | Status |
|-------|------|--------|
| 0 | Setup & Documentation | [x] Complete |
| 1 | Data Layer Swap (Qdrant Cloud, OpenAI embeddings, Supabase) | [x] Complete |
| 2 | Telegram + Two-User Support | [x] Complete |
| 3 | Notion Integration | [ ] Not started |
| 4 | Email Channel (Resend) | [ ] Not started |
| 5 | Web Dashboard | [ ] Not started |
| 6 | CI/CD Pipeline & Deployment Hardening | [x] Complete |

## Outstanding Work

- [ ] Add Tash's Telegram user ID for partner access
- [ ] Custom domain + Caddy HTTPS
- [ ] Notion integration (Phase 3)
- [ ] Email via Resend (Phase 4)
- [ ] Web admin dashboard (Phase 5)
- [ ] Remove debug logging artifacts from production code
- [ ] Rotate API keys exposed during setup (Anthropic, OpenAI, Qdrant, Telegram bot token)

## Next Steps

1. Rotate exposed API keys
2. Add Tash's Telegram ID for partner access
3. Phase 3: Notion integration (bidirectional sync)

## Open Decisions

See `docs/status/open-decisions.md` — no open decisions.
