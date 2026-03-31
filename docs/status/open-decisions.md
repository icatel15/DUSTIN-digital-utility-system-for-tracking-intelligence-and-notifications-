# Open Decisions

Unresolved decisions requiring user input before work can proceed.

**ID convention**: `OD-{sequence}` (e.g., OD-01, OD-02)

---

No open decisions at this time.

## Resolved

**OD-06** (resolved 2026-03-31): Container registry → GHCR (`ghcr.io/icatel15/dustin`). No Docker Hub account needed; built-in GITHUB_TOKEN handles workflow auth.

**OD-07** (resolved 2026-03-31): Deploy user → `dustin`. Docker handles runtime isolation; dedicated deploy user adds complexity without meaningful security gain.
