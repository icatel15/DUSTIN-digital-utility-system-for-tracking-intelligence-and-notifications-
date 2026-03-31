# CI/CD Pipeline

Automated build, test, and deployment pipeline for DUSTIN. Replaces the current manual `scp + systemctl restart` workflow with a Docker-based GitHub Actions pipeline.

## Overview

```
PR opened ──► CI (lint + typecheck + test)
                    │
Merge to main ──► CI passes ──► Docker build + push to GHCR (sha-xxx + latest)
                                       │
                                 Deploy job: SSH ──► docker compose pull ──► up -d
                                       │
                                 Health check: curl /health ──► verify status (120s)
                                       │
                                 Failure? ──► rollback to previous image
```

One immutable Docker image flows through the entire pipeline. The same artifact tested in CI is what runs in production.

## Key Decisions

### Docker over systemd (D-6.01)

| Concern | systemd (old) | Docker (current) |
|---|---|---|
| Rollback | No mechanism | Pull previous image tag |
| Environment parity | Bun version, OS packages drift | Same image in CI and prod |
| Immutable artifacts | Code copied loose | Tagged image is the artifact |
| Health verification | Manual curl | Built-in `HEALTHCHECK` + compose restart policy |
| Overhead | ~0 | Docker daemon ~50MB RAM — negligible |

### GHCR over Docker Hub (D-6.04)

Uses GitHub Container Registry (`ghcr.io/icatel15/dustin`) instead of Docker Hub:
- No separate Docker Hub account needed
- Authenticates via built-in `GITHUB_TOKEN` in workflows (zero secrets to manage)
- Private images (repo is private) — VPS pulls with a GitHub PAT (`read:packages` scope)
- Free tier: 500MB packages storage

### Deploy user: `dustin` (D-6.03)

The existing `dustin` VPS user handles SSH deploys. Docker group membership is effectively root-equivalent, so a dedicated `deploy` user would add complexity without security gain.

### CI triggers: PR + workflow_call only (D-6.05)

`ci.yml` triggers on PRs and as a reusable workflow (called by `deploy.yml` and `release.yml`). It does **not** trigger independently on push to main — `deploy.yml` handles that, calling CI as a gate. This avoids double CI runs on every merge.

## Workflow 1: CI (`ci.yml`)

**Triggers**: Pull requests to `main`, `workflow_call` (reusable).

```yaml
test:
  runs-on: ubuntu-latest
  steps:
    - Checkout
    - Setup Bun (with dependency caching)
    - bun install --frozen-lockfile
    - bun run lint
    - bun run typecheck
    - bun test
```

## Workflow 2: Deploy (`deploy.yml`)

**Triggers**: Push to `main`.

### Jobs

#### `test` (gate)
Calls `ci.yml` as a reusable workflow. Deploy only proceeds if CI passes.

#### `build-and-push` (needs: test)
1. Set up Docker Buildx
2. Login to GHCR via `GITHUB_TOKEN`
3. Build and push `ghcr.io/icatel15/dustin:sha-xxx` + `:latest`
4. Single arch (linux/amd64 — VPS is amd64)
5. GitHub Actions build cache

#### `deploy` (needs: build-and-push)
1. SSH to VPS as `dustin` using `secrets.VPS_SSH_KEY`
2. Record current image digest for rollback
3. `docker compose pull dustin` + `docker compose up -d dustin`
4. Health check: poll `/health` every 5s for up to 120s (matches Dockerfile `start-period`)
5. On failure: verify old image exists locally, then rollback (stop → retag → restart)
6. If old image not found: leave container running, exit with failure

#### `smoke-test` (needs: deploy)
External health check from GitHub Actions runner (outside VPS network).

### Concurrency

```yaml
concurrency:
  group: deploy-production
  cancel-in-progress: false
```

Only one deploy at a time. New pushes queue.

## Workflow 3: Release (`release.yml`)

**Triggers**: Push of `v*` tag.

1. CI gate (calls `ci.yml`)
2. Multi-arch build (linux/amd64 + linux/arm64)
3. Push with semver tags: `v1.2.3`, `v1.2`, `sha-xxx`, `latest`
4. Verify image pulls and runs

## GitHub Secrets

| Secret | Purpose | Status |
|---|---|---|
| `VPS_SSH_KEY` | SSH private key (ed25519) for deploy | Set |
| `VPS_HOST` | VPS IP address (178.104.134.128) | Set |

No Docker Hub secrets needed — GHCR authenticates via the built-in `GITHUB_TOKEN`.

## VPS Setup

### GHCR Authentication (one-time)

The VPS needs a GitHub PAT to pull private images:

1. Create a PAT at github.com → Settings → Developer settings → Personal access tokens
2. Scope: `read:packages` only
3. On the VPS: `echo "<token>" | docker login ghcr.io -u icatel15 --password-stdin`

Docker stores the credential in `~/.docker/config.json` — persists across reboots.

### Directory Structure

```
/home/dustin/app/
  docker-compose.yaml    # From docker-compose.user.yaml in repo
  .env                   # Secrets — never in git, never overwritten by deploy
```

### Docker Volumes

```
dustin_config    → /app/config        (YAML configs)
dustin_evolved   → /app/phantom-config (evolved personality, constitution)
dustin_data      → /app/data          (SQLite state)
dustin_public    → /app/public        (public assets)
dustin_repos     → /app/repos         (cloned repositories)
```

## Rollback Strategy

### Automatic (health check failure)

Deploy records the current image digest before pulling. If health check fails:

1. Verify previous image still exists locally
2. If yes: stop container → retag previous digest as `:latest` → restart
3. If no: leave container running (avoid total outage), exit with failure

### Manual

```bash
# On the VPS — roll back to a specific SHA
cd /home/dustin/app
docker pull ghcr.io/icatel15/dustin:sha-abc1234
docker tag ghcr.io/icatel15/dustin:sha-abc1234 ghcr.io/icatel15/dustin:latest
docker compose up -d dustin
```

## Migration Plan

### One-time VPS setup

1. Install Docker (`scripts/migrate-to-docker.sh` handles this)
2. Stop and disable systemd DUSTIN service
3. Create GitHub PAT with `read:packages` scope
4. Login to GHCR on the VPS
5. Copy `docker-compose.user.yaml` to VPS as `docker-compose.yaml`
6. Pull image and start container
7. Verify health + Telegram responds

### Cutover sequence

1. Create GitHub PAT with `read:packages` scope
2. Commit and merge CI/CD changes → first workflow builds and pushes image to GHCR
3. SCP compose file + migration script to VPS
4. Run migration script (installs Docker, stops systemd, authenticates GHCR, pulls, starts)
5. Verify health → DUSTIN is now Docker-deployed with CI/CD
6. All future merges to main auto-deploy

## Acceptance Criteria

1. **CI runs on PR**: lint, typecheck, and all 804+ tests pass
2. **Merge to main triggers deploy**: image built, pushed to GHCR, deployed to VPS
3. **Health check gates deploy**: `/health` must return `{"status":"ok"}` or deploy rolls back
4. **Rollback works**: if health check fails, previous image is restored automatically
5. **Secrets never in git**: SSH keys, API tokens are GitHub secrets or VPS env vars only
6. **No manual steps**: after merge, deploy is fully automated
7. **Telegram responds after deploy**: bot answers messages within 30s of deploy completion
8. **Concurrent deploys are safe**: only one deploy runs at a time, others queue
