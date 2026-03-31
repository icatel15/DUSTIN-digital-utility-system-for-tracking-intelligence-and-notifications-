---
name: DUSTIN Project Status
description: Current deployment state and key infrastructure details for DUSTIN
type: project
---

DUSTIN is live on Hetzner VPS at 178.104.134.128, responding via Telegram (@Dustin_CWBot). Phases 0-2 complete as of 2026-03-31.

**Infrastructure:**
- Hetzner CX23 (2 vCPU, 4GB RAM), Ubuntu 24.04, systemd service `dustin.service`
- SSH key: `~/.ssh/dustin_hetzner`, user: `dustin` (app at `/home/dustin/app`), root for systemd
- Supabase project: `abmroxxvoatrbexhmqup` (eu-west-2), linked via CLI
- Qdrant Cloud: eu-west-2 cluster
- Claude Code CLI installed globally on server (`/usr/bin/claude`)
- systemd needs `EnvironmentFile=/home/dustin/app/.env` and `Environment=HOME=/home/dustin` for the Agent SDK to work

**Key deployment lessons:**
- Claude Agent SDK spawns `claude` CLI as subprocess — must be installed on server
- Telegraf `launch()` never resolves (infinite polling loop) — must be fire-and-forget
- systemd `ProtectSystem=strict` requires `ReadWritePaths=/home/dustin/app` for SDK session files
- Deploy is currently manual: `scp` files + `systemctl restart dustin`. CI/CD pipeline is next.

**Why:** Deploy pipeline is the immediate next priority to avoid manual scp workflow.

**How to apply:** Read `docs/status/index.md` for full outstanding work list. Next session: build deploy script or CI/CD.
