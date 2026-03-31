# src/channels/ -- Channel adapters, routing, and messaging infrastructure

Universal rules are governed by the root `CLAUDE.md`.

## Channel Interface

Defined in `types.ts`. Every adapter implements the `Channel` interface:

```
connect(): Promise<void>
disconnect(): Promise<void>
send(conversationId: string, message: OutboundMessage): Promise<SentMessage>
onMessage(handler: (message: InboundMessage) => Promise<void>): void
```

Each channel declares `id`, `name`, and `capabilities` (threads, richText, attachments, buttons, reactions, typing, messageEditing, progressUpdates, inlineKeyboards).

## Channel Adapter Inventory

| File | Channel ID | Transport | Auth/Security |
| --- | --- | --- | --- |
| `telegram.ts` | `telegram` | Telegraf long polling | Owner/partner user ID allowlist via `telegram-users.ts`. Unauthorized users get a rejection message. |
| `slack.ts` | `slack` | Slack Bolt Socket Mode | Owner user ID gate. Non-owner messages trigger a one-time DM rejection. |
| `email.ts` | `email` | ImapFlow (IMAP IDLE) + Nodemailer (SMTP) | IMAP/SMTP credentials. Auto-reply detection skips bot loops. |
| `webhook.ts` | `webhook` | HTTP POST with HMAC-SHA256 | `X-Webhook-Signature` + `X-Webhook-Timestamp` headers. 5-minute replay window. Callback URLs validated via `url-validator.ts` (SSRF protection). |
| `cli.ts` | `cli` | Node readline (stdin/stdout) | None (local development only). |

## Router

`router.ts` (`ChannelRouter`) manages the channel registry:
- `register(channel)` -- adds a channel and wires its `onMessage` to the router's inbound handler.
- `connectAll()` / `disconnectAll()` -- parallel connect/disconnect with `Promise.allSettled` (one failure does not block others).
- `send(channelId, conversationId, message)` -- dispatches an outbound message to the correct channel.
- `onMessage(handler)` -- sets the single inbound handler (typically the orchestrator/agent bridge).

## Supporting Modules

| File | Purpose |
| --- | --- |
| `feedback.ts` | Feedback signal types and Slack Block Kit feedback/action button builders. Routes positive/negative/partial signals to the evolution engine via `setFeedbackHandler()`. |
| `slack-actions.ts` | Registers Bolt action handlers for feedback buttons and agent-suggested action buttons. Owner-gated. Wires to `emitFeedback()` and an optional `ActionFollowUpHandler`. |
| `slack-formatter.ts` | `toSlackMarkdown()` converts standard markdown to Slack mrkdwn. `splitMessage()` chunks messages at safe boundaries (3900 char limit). `truncateForSlack()` for single-block truncation. |
| `progress-stream.ts` | `createProgressStream()` posts a "Working on it..." message and progressively updates it with tool activity lines. Throttled at 1s to respect Slack rate limits. `formatToolActivity()` maps tool names to human-readable summaries. |
| `status-reactions.ts` | `createStatusReactionController()` manages emoji reactions on user messages to show agent state (queued, thinking, tool use, done, error). Debounced at 500ms with stall detection at 10s/30s. |
| `telegram-users.ts` | User management for Telegram: `ensureUser()` upserts user records in Supabase, `isAuthorizedUser()` checks allowlist, `determineChatContext()` resolves group/dm_owner/dm_partner context. Caches users in memory. |

## Adding a New Channel

1. Create `src/channels/{name}.ts` implementing the `Channel` interface from `types.ts`.
2. Choose a unique `id` string (lowercase, used as the channel key everywhere).
3. Declare capabilities honestly -- the orchestrator uses these to decide what features to use.
4. Register the new channel with `ChannelRouter.register()` in the application bootstrap.
5. Add tests in `__tests__/{name}.test.ts`.
6. Update this file.

## Dependencies

- **`@slack/bolt`** -- Slack adapter (Socket Mode, events, actions).
- **`telegraf`** -- Telegram adapter (long polling, inline keyboards).
- **`imapflow`** / **`nodemailer`** -- Email adapter (IMAP IDLE + SMTP).
- **`../db/connection.ts`** (`SupabaseClient`) -- user records (Telegram), session data.
- **`../utils/url-validator.ts`** -- SSRF-safe callback URL validation (webhook).

## Update Protocol

Update this file when:
- Adding, removing, or renaming a channel adapter.
- Changing the `Channel` interface or `ChannelCapabilities` type.
- Modifying the router's dispatch or registration logic.
- Adding new supporting modules (formatters, reaction controllers, etc.).
