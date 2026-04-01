# Phase 8 — Multi-Model Routing

**Spec**: `docs/specs/phase-8-multi-model-routing.md`
**Status**: [ ] Not started — spec approved 2026-03-31

## Deliverables

- [ ] Migration: `mode` and `build_task_summary` columns on `sessions` table
- [ ] `src/agent/model-router.ts` — routing logic with build trigger detection
- [ ] `SessionStore` updates — read/write mode state
- [ ] `AgentRuntime.handleMessage()` — use routed model, mode switching, casual interrupt handling
- [ ] `PhantomConfigSchema` — add `build_model` field + `PHANTOM_BUILD_MODEL` env override
- [ ] Build mode prompt additions in `prompt-assembler.ts`
- [ ] Mode prefix on all outbound messages (Telegram, Slack, webhook)
- [ ] Mode switch announcements (chat -> build, build -> chat)
- [ ] Approval gate — present artifacts for review before activating
- [ ] Sonnet unavailability handling — refuse build mode gracefully
- [ ] Unit tests for model router, prefix injection, build prompt
- [ ] Integration tests for session mode persistence, model switching, approval gate, casual interrupts

## Decisions

(none yet)

## Deviations

(none yet)
