# LLM Judge Subsystem

Sonnet/Haiku-powered judges that validate evolution deltas and extract observations. Used by the evolution engine when `ANTHROPIC_API_KEY` is set and the daily cost cap is not exhausted. Every judge falls back to heuristics (in the parent module) on failure.

Universal rules are governed by the root `CLAUDE.md`. Parent module context in `src/evolution/CLAUDE.md`.

## Judge Inventory

| File | Judge | Purpose | Model | Strategy |
|---|---|---|---|---|
| `safety-judge.ts` | Safety Gate | Detect self-preservation, scope creep, manipulation, permission escalation, deception, evolution tampering | 3x Sonnet | Minority veto (fail-closed) |
| `constitution-judge.ts` | Constitution Gate | Check proposed deltas against constitutional principles | 3x Sonnet | Minority veto (fail-closed) |
| `regression-judge.ts` | Regression Gate | Test deltas against golden suite cases | Haiku first, Sonnet escalation | Cascaded |
| `observation-judge.ts` | Observation Extraction | Extract corrections, preferences, errors, sentiment from session transcript | 1x Sonnet | Single call |
| `quality-judge.ts` | Quality Assessment | Score session quality across 6 dimensions; detect regression signals for auto-rollback | 1x Sonnet | Single call |
| `consolidation-judge.ts` | Memory Consolidation | Extract structured facts, procedures, and contradictions for long-term memory | 1x Sonnet | Single call |

## 5-Gate Validation Flow

Called from `validation.ts:validateAllWithJudges()` for each delta:

1. **Constitution Gate** -- Triple Sonnet, minority veto. Any judge failing with confidence > 0.7 rejects. **Fail-closed** on error.
2. **Regression Gate** -- Haiku evaluates each golden case. Cases with confidence < 0.9 escalate to Sonnet. **Falls back to heuristic** on error.
3. **Size Gate** -- Deterministic (no LLM). Checks projected line count against `max_file_lines`.
4. **Drift Gate** -- Deterministic (no LLM). Cosine similarity (if embeddings available) or Jaccard similarity.
5. **Safety Gate** -- Triple Sonnet, minority veto. **Fail-closed** on error.

## Shared Infrastructure

| File | Responsibility |
|---|---|
| `client.ts` | `callJudge()` -- single structured-output call via Anthropic SDK; `multiJudge()` -- parallel execution with voting (minority_veto/majority/unanimous) |
| `prompts.ts` | All prompt templates. Every prompt forces reasoning-before-verdict to reduce bias. |
| `schemas.ts` | Zod v4 schemas for structured output (required by `zodOutputFormat`). Defines output shapes for all judges. |
| `types.ts` | Model constants (Sonnet, Haiku, Opus), `JudgeResult`, `MultiJudgeResult`, `JudgeCosts`, voting strategies |

## Input/Output Contract

**Input**: Every judge receives a system prompt (from `prompts.ts`) and a user message containing the proposed delta (file, type, content, rationale) plus current config context.

**Output**: `JudgeResult<T>` containing:
- `verdict`: "pass" or "fail"
- `confidence`: 0-1
- `reasoning`: string explanation
- `data`: Schema-specific structured data (e.g., `SafetyGateResultType`, `ConstitutionGateResultType`)
- `costUsd`, `inputTokens`, `outputTokens`, `durationMs`

Multi-judge calls return `MultiJudgeResult<T>` with `individualResults[]` and `strategy`.

## LLM vs Rule-Based

- **LLM judges**: Safety, constitution, regression, observation extraction, quality, consolidation. Provide richer analysis (implicit corrections, sentiment, contradiction detection).
- **Rule-based (heuristic)**: All gates have regex/pattern fallbacks in the parent module (`validation.ts`, `reflection.ts`). Used when: no API key, daily cost cap reached, or LLM call fails.
- **Always deterministic**: Size gate and drift gate never use LLM.

## Adding a New Judge

1. Define the output schema in `schemas.ts` using `zod/v4` (required for `zodOutputFormat`).
2. Add the prompt template in `prompts.ts` -- always require reasoning before verdict.
3. Create a new `{name}-judge.ts` file that calls `callJudge()` or `multiJudge()` from `client.ts`.
4. Add the cost tracking key to `JudgeCosts` in `types.ts` and update `emptyJudgeCosts()`.
5. Wire the judge into the engine (`engine.ts`) or validation (`validation.ts`) in the parent module.
6. For safety-critical judges, use triple Sonnet with minority veto and fail-closed on error.

## Key Constants

- `JUDGE_MODEL_SONNET`: `claude-sonnet-4-6`
- `JUDGE_MODEL_HAIKU`: `claude-haiku-4-5`
- `JUDGE_TEMPERATURE`: 0 (deterministic)
- `JUDGE_MAX_TOKENS`: 4096
- Minority veto confidence threshold: 0.7

## Update Protocol

Update this file when adding new judges, changing voting strategies, modifying the LLM client, or updating model versions.
