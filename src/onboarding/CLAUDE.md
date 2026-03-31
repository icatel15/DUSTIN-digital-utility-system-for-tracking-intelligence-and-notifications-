# src/onboarding/ — First-run detection and guided setup flow

Universal rules (methodology, TDD, DFD, code style) are governed by the root `CLAUDE.md`.

## File Inventory

| File | Purpose |
| --- | --- |
| `detection.ts` | `isFirstRun` (checks `meta/version.json` for generation 0) and `isOnboardingInProgress` (queries `onboarding_state` table) |
| `state.ts` | CRUD for `onboarding_state` table — `getOnboardingStatus`, `markOnboardingStarted`, `markOnboardingComplete` |
| `flow.ts` | `startOnboarding` — orchestrates profiling, intro message generation, and delivery via Slack |
| `prompt.ts` | `buildOnboardingPrompt` — generates the system prompt section injected during onboarding mode |
| `profiler.ts` | `profileOwner` — fetches owner's Slack profile, workspace name, and channel memberships; `hasPersonalizationData` — checks if profile has enough data for personalization |
| `__tests__/*.test.ts` | Unit tests for each module |

## Onboarding State Machine

```
pending  ──▶  in_progress  ──▶  complete
```

- **pending**: Default state when no `onboarding_state` row exists.
- **in_progress**: Set by `markOnboardingStarted` when the flow begins. Idempotent — skips insert if already in progress.
- **complete**: Set by `markOnboardingComplete`, which updates all `in_progress` rows with a `completed_at` timestamp.

State is persisted in the `onboarding_state` Supabase table and survives restarts.

## First-Run Detection

`isFirstRun(configDir)` reads `{configDir}/meta/version.json`. Returns `true` if the file is missing or `version` is `0`. This is a filesystem check, not a database check.

`isOnboardingInProgress(db)` queries the most recent `onboarding_state` row. Returns `true` if status is `in_progress`.

## Onboarding Flow (`startOnboarding`)

1. Marks onboarding as `in_progress` in the database.
2. If the target is a DM and a Slack client is available, profiles the owner via `profileOwner`.
3. Builds an intro message — personalized (using owner name, team, role) or generic depending on profile data availability.
4. Sends the intro via Slack DM or channel post.
5. Returns the `OwnerProfile` if it has useful personalization data, otherwise `null`.

## Prompt Injection

`buildOnboardingPrompt(role, phantomName, ownerProfile?)` produces a system prompt section that:
- Instructs the agent to have a natural conversation (no checklists).
- Includes an `## Owner Context` block with profile details when available.
- Directs the agent to actively explore repos, tools, and services.
- Tells the agent to persist learnings to `phantom-config/user-profile.md` and `phantom-config/domain-knowledge.md`.

## Owner Profiling

`profileOwner(client, ownerUserId)` fetches in parallel:
- User info (name, title, timezone, admin/owner status, status text)
- Team info (workspace name)
- Channel memberships (public channels, up to 100)

All API calls are best-effort — failures degrade gracefully to null/default fields. `hasPersonalizationData` returns `true` if the profile has a real name, title, or channel list.

## Dependencies

- `src/db/connection.ts` — `SupabaseClient` type for database operations
- `src/channels/slack.ts` — `SlackChannel` for message delivery
- `src/roles/types.ts` — `RoleTemplate` type (currently unused in logic but part of function signatures)

## Update Protocol

Update this file when changing the onboarding state machine, adding new detection methods, modifying the prompt template, or changing how owner profiling works.
