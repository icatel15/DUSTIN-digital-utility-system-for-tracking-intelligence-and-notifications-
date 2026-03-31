# DUSTIN — Master Status

**Read this file at the start of every session.**

## Project

DUSTIN (Digital Utility System for Tracking, Intelligence & Notifications)

## Current Phase

**Phase 6 — CI/CD Pipeline & Deployment Hardening** (in progress)

## Current State

- DUSTIN live on Hetzner VPS (178.104.134.128), responding via Telegram (@Dustin_CWBot)
- Telegram two-user mode active (Woody = owner, Tash = partner pending ID)
- All managed services connected: Qdrant Cloud, OpenAI embeddings, Supabase
- Self-evolution running (generation 5, LLM judges enabled)
- 804 tests passing
- Deploy is manual (scp + systemctl restart) — migrating to Docker + CI/CD
- CI/CD spec documented (`docs/ci-cd.md`)

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
| 6 | CI/CD Pipeline & Deployment Hardening | [-] In progress |

## Outstanding Work

- [-] CI/CD pipeline (Phase 6 — spec done, implementation next)
- [ ] VPS migration: systemd → Docker
- [ ] Add Tash's Telegram user ID for partner access
- [ ] Custom domain + Caddy HTTPS
- [ ] Notion integration (Phase 3)
- [ ] Email via Resend (Phase 4)
- [ ] Web admin dashboard (Phase 5)
- [ ] Remove debug logging artifacts from production code
- [ ] Rotate API keys exposed during setup (Anthropic, OpenAI, Qdrant, Telegram bot token)

## Next Steps

1. Implement CI/CD workflows (Phase 6)
2. Migrate VPS from systemd to Docker
3. Rotate exposed API keys
4. Add Tash's Telegram ID for partner access

## Open Decisions

See `docs/status/open-decisions.md` — all resolved (OD-06: `ghostwright/dustin`, OD-07: `dustin` user).
