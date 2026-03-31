# Self-Evolution Engine

The agent's self-improvement pipeline. After each session, observes behaviour, critiques performance, proposes config changes, validates them through safety gates, and applies approved changes to phantom-config/.

Universal rules are governed by the root `CLAUDE.md`.

## 6-Step Pipeline

Orchestrated by `EvolutionEngine.afterSession()` in `engine.ts`:

1. **Observation** (`reflection.ts`) -- Extract corrections, preferences, errors, domain facts from the session transcript. LLM judge (Sonnet) preferred; regex fallback when unavailable.
2. **Critique** (`reflection.ts`) -- Build a `CritiqueResult` from observations: what worked, what failed, suggested config changes. Heuristic by default; LLM reflection prompt available via `buildReflectionPrompt()`.
3. **Delta Generation** (`reflection.ts`) -- Convert critique suggestions into atomic `ConfigDelta` objects with file, type (append/replace/remove), content, rationale, and tier.
4. **5-Gate Validation** (`validation.ts`) -- Every delta must pass all 5 gates (see judges/ CLAUDE.md). LLM judges used when available; heuristic fallback otherwise.
5. **Application** (`application.ts`) -- Write approved deltas to phantom-config/ files, bump version, append to evolution-log.jsonl. Successful corrections promoted to the golden suite.
6. **Consolidation** (`consolidation.ts`) -- Periodic (every N sessions): group observations, extract principles, compress oversized files, prune session log.

## Service Inventory

| File | Responsibility |
|---|---|
| `engine.ts` | `EvolutionEngine` class -- orchestrates the pipeline, manages daily LLM cost cap, auto-rollback |
| `reflection.ts` | Steps 1-3: observation extraction (LLM + heuristic), critique building, delta generation |
| `validation.ts` | Step 4: 5-gate validation -- constitution, regression, size, drift, safety (LLM + heuristic) |
| `application.ts` | Step 5: apply approved deltas to files, update version.json, write evolution-log.jsonl |
| `consolidation.ts` | Step 6: periodic principle extraction, duplicate pruning, oversized file compression |
| `constitution.ts` | `ConstitutionChecker` -- loads constitution.md, pattern-matches against violation patterns |
| `golden-suite.ts` | Golden test suite CRUD (JSONL) -- load, add, prune, find affected cases |
| `metrics.ts` | Read/write metrics.json, session/evolution/rollback counters, auto-rollback detection |
| `versioning.ts` | Version tracking -- read/write version.json, create next version, rollback by reversing changes |
| `config.ts` | Load and validate `config/evolution.yaml` via Zod schema |
| `types.ts` | All shared type definitions for the evolution module |

## Config Structure

- **YAML config**: `config/evolution.yaml` -- cadence intervals, gate thresholds, reflection model, judge settings, file paths.
- **phantom-config/**: Evolved config files -- `constitution.md` (immutable), `persona.md`, `user-profile.md`, `domain-knowledge.md`, `strategies/*.md`.
- **phantom-config/meta/**: `version.json`, `metrics.json`, `evolution-log.jsonl`, `golden-suite.jsonl`.
- **phantom-config/memory/**: `session-log.jsonl`, `principles.md`, `corrections.md`.

## Config Tiers

- **immutable**: Cannot be changed (constitution.md). Constitution gate rejects all mutations.
- **constrained**: Can be changed but with stricter validation.
- **free**: User-profile, domain-knowledge, strategies -- normal validation only.

## Key Business Rules

- Safety-critical gates (constitution, safety) **fail closed** on LLM errors -- deltas are rejected.
- Non-critical gates (regression) **fall back to heuristics** on LLM errors.
- Daily LLM judge cost cap (default $50/day) -- switches to heuristics when exhausted.
- Auto-rollback triggers when success rate drops by more than the threshold within the evaluation window.
- Golden suite capped at configurable max size (default 50); oldest entries pruned.
- Consolidation runs every N sessions (default 10), resets counter after completion.

## Dependencies

- `judges/` subdirectory: LLM-powered validation judges (see `src/evolution/judges/CLAUDE.md`).
- `../shared/patterns.ts`: Regex patterns for correction/preference/domain-fact detection.
- Anthropic API (via judges): Required for LLM judge mode, optional for heuristic-only mode.
- File system: All state persisted as JSON/JSONL/Markdown in phantom-config/.

## Update Protocol

Update this file when adding pipeline steps, changing gate logic, modifying config file paths, or altering the validation flow.
