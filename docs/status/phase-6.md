# Phase 6 — CI/CD Pipeline & Deployment Hardening

**Status**: Complete
**Started**: 2026-03-31
**Completed**: 2026-03-31

## Deliverables

- [x] CI/CD pipeline spec documented (`docs/ci-cd.md`)
- [x] Strengthen CI workflow — PR trigger, Bun caching, reusable via workflow_call (`.github/workflows/ci.yml`)
- [x] Deploy workflow — Docker build → push to GHCR → SSH deploy → health check → rollback (`.github/workflows/deploy.yml`)
- [x] Automatic rollback on health check failure (built into deploy.yml)
- [x] Release workflow — rebranded from docker-publish.yml, GHCR image (`.github/workflows/release.yml`)
- [x] Smoke test job — external health verification (built into deploy.yml)
- [x] Deploy SSH key setup (GitHub secret `VPS_SSH_KEY` + VPS authorized_keys)
- [x] Add `VPS_HOST` GitHub secret
- [x] Migration script (`scripts/migrate-to-docker.sh`)
- [x] VPS GHCR authentication (both root and dustin users)
- [x] VPS migration: Docker installed, systemd stopped, container running
- [x] Health check verified: status ok, Telegram connected, Qdrant connected, generation 5
- [x] Fix pre-existing lint errors (140 biome violations, noExplicitAny in tests)
- [x] Fix pre-existing type errors (missing awaits, unused vars, null handling)
- [x] Fix flaky crypto test (auth tag tamper test across Bun versions)

## Decisions

**D-6.01** (2026-03-31): Docker-based deployment over systemd.
- Context: DUSTIN currently deploys via manual `scp + systemctl restart`. Need automated, robust pipeline.
- Decision: Use Docker for production deployment — build immutable image in CI, push to registry, deploy via `docker compose pull/up`.
- Rationale: Immutable artifacts, instant rollback, environment parity, and 80% of the infrastructure already exists (Dockerfile, docker-compose.yaml, docker-publish workflow).

**D-6.02** (2026-03-31): Image name `ghcr.io/icatel15/dustin`.
- Context: Old workflow published to `ghostwright/phantom` on Docker Hub. DUSTIN is a rebrand.
- Decision: Use GHCR instead of Docker Hub. Image at `ghcr.io/icatel15/dustin`.
- Rationale: Clean separation from upstream Phantom. No Docker Hub account needed.

**D-6.03** (2026-03-31): Deploy user is `dustin` (existing VPS user).
- Context: Considered dedicated `deploy` user for least-privilege.
- Decision: Use existing `dustin` user. Docker group membership is effectively root-equivalent anyway.
- Rationale: Simpler setup, no meaningful security gain from a separate user.

**D-6.04** (2026-03-31): GHCR over Docker Hub for container registry.
- Context: No Docker Hub account exists. Would need to create account + generate token + manage secrets.
- Decision: Use GitHub Container Registry (ghcr.io). Workflows authenticate via built-in GITHUB_TOKEN. VPS pulls with a GitHub PAT (read:packages).
- Rationale: Zero additional accounts to manage. Everything stays within GitHub. Free 500MB storage sufficient for single-image deployment.

**D-6.05** (2026-03-31): CI triggers on PR + workflow_call only (not push to main).
- Context: Code review found that both ci.yml and deploy.yml triggering on push to main causes double CI runs.
- Decision: ci.yml triggers on PR and workflow_call only. deploy.yml calls ci.yml as a gate on push to main.
- Rationale: CI runs exactly once per event. deploy.yml is the sole push-to-main workflow.

## Deviations

**V-6.01**: Spec initially described Docker Hub as the registry. Switched to GHCR after discovering no Docker Hub account existed — simpler setup with zero external accounts.

**V-6.02**: Spec described three separate workflows (CI, Deploy, Release). Deploy and Release reuse CI as a called workflow via `workflow_call` rather than duplicating test steps.

**V-6.03**: 140 pre-existing lint errors and several type errors had to be fixed before CI could pass. These were never caught because the old CI only ran on PRs, not on pushes to main.

## Open Decisions

All resolved. See `docs/status/open-decisions.md`.
