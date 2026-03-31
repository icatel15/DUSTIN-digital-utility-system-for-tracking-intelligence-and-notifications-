---
name: DUSTIN Project Status
description: Current deployment state, infrastructure details, and active work for DUSTIN
type: project
---

DUSTIN is live on Hetzner VPS at 178.104.134.128, responding via Telegram (@Dustin_CWBot). Phases 0-2, 6 complete. Running via Docker (migrated from systemd 2026-03-31).

**Infrastructure:**
- Hetzner CX23 (2 vCPU, 4GB RAM), Ubuntu 24.04
- SSH key: `~/.ssh/dustin_hetzner`, user: `dustin` (app at `/home/dustin/app`), root for systemd
- Supabase project: `abmroxxvoatrbexhmqup` (eu-west-2), linked via CLI
- Qdrant Cloud: eu-west-2 cluster
- CI/CD live: merge to main -> auto-deploy via Docker + GHCR
- Claude Code CLI installed globally on server (`/usr/bin/claude`)

**Active work: Security Hardening (signed off 2026-03-31)**
- Plan document: `docs/security-hardening-plan.md`
- 5 findings from external security review, all approved for implementation
- Finding 1 (Critical): Unauthenticated POST /trigger — add bearer token + timingSafeEqual + rate limit + audit
- Finding 2 (Critical): MCP scopes never enforced — transport-layer intercept, deny-by-default, session binding
- Finding 3 (High): Secret store session scoping — bound sessions, field validation, single-use magic links
- Finding 4 (Medium): Webhook SSRF — async DNS validation, redirect: "manual", IPv4-mapped IPv6
- Finding 5 (Medium): Slack action owner bypass — isOwner callback + reaction gating

**Why:** Security hardening is the immediate next implementation priority.

**How to apply:** Read `docs/security-hardening-plan.md` for full remediation details. Findings 1, 3, 5 can be parallelized. All require tests before merge.
