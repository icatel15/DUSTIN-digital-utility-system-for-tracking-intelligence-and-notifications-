# src/scheduler/ -- Task scheduling engine

Manages creation, persistence, execution, and delivery of scheduled jobs. Supports one-shot, interval, and cron-based schedules with Slack delivery and exponential backoff on failure.

Universal rules are governed by the root `CLAUDE.md`.

## File Inventory

| File | Purpose |
| --- | --- |
| `types.ts` | Zod schemas and types for schedules (`at`, `every`, `cron`), `JobDelivery`, `ScheduledJob`, `JobCreateInput`, `JobRow` (DB shape) |
| `schedule.ts` | Pure schedule math: `computeNextRunAt`, `computeBackoffNextRun`, `parseScheduleValue`, `serializeScheduleValue`. Uses `croner` for cron parsing |
| `service.ts` | `Scheduler` class -- the core engine. Creates/deletes/lists jobs, arms a timer for the next due job, executes due jobs, delivers results via Slack, recovers missed jobs on startup |
| `tool.ts` | MCP tool server (`phantom_schedule`) exposing create/list/delete/run actions to the agent via `@anthropic-ai/claude-agent-sdk` |

## Schedule Types

- **`at`**: One-shot at an ISO 8601 timestamp. Auto-completes or auto-deletes after execution.
- **`every`**: Recurring at a fixed interval in milliseconds.
- **`cron`**: 5-field cron expression with optional IANA timezone.

## How Tasks Are Scheduled and Executed

1. `createJob()` inserts a row into `scheduled_jobs` (Supabase), computes `next_run_at`, and re-arms the timer.
2. A single `setTimeout` timer fires at the earliest `next_run_at` (clamped to 60s max to handle drift).
3. `onTimer()` queries all due jobs and executes them sequentially with a concurrency guard (one execution at a time).
4. `executeJob()` calls `runtime.handleMessage()` with the job's task prompt, records duration/status/errors, and computes the next run.
5. Results are delivered via `SlackChannel.sendDm()` or `postToChannel()` based on `JobDelivery` config.

## Error Handling

- Consecutive errors trigger exponential backoff: 30s, 1m, 5m, 15m, 60m.
- After 10 consecutive errors, the job status is set to `failed` and the owner is notified.
- One-shot (`at`) jobs fail permanently after 3 consecutive errors.

## Delivery

- `channel: "slack"` with `target: "owner"` sends a DM to the configured owner user.
- Targets starting with `C` post to a Slack channel; `U` sends a DM to a specific user.
- A `deliveryAllowlist` restricts which targets are permitted (validated at creation and delivery time).
- `channel: "none"` suppresses delivery (useful for maintenance tasks).

## Startup Recovery

On `start()`, the scheduler queries jobs with `next_run_at` in the past and executes them with a 5-second stagger to avoid overload.

## Dependencies

- `croner` -- cron expression parsing and next-run computation
- `@anthropic-ai/claude-agent-sdk` -- MCP tool server creation
- `zod` -- input validation
- `src/agent/runtime.ts` (`AgentRuntime`) -- executes task prompts
- `src/channels/slack.ts` (`SlackChannel`) -- result delivery
- `src/db/connection.ts` (`SupabaseClient`) -- job persistence

## Update Protocol

Update this file when changing schedule types, execution logic, delivery channels, or the MCP tool interface.
