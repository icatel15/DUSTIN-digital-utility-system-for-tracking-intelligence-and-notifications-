# Phase 2 — Telegram Channel + Two-User Support

## Overview

Adapt Phantom's existing Telegram channel for DUSTIN's two-user model. Three chat contexts (shared group, owner DM, partner DM), user authentication, and chat context tagging on all inbound messages.

## Existing State

Phantom's `src/channels/telegram.ts` already supports:
- Long polling via Telegraf
- Text messages, commands (/start, /status, /help)
- Inline keyboards, typing indicators, message editing
- MarkdownV2 formatting

What it lacks:
- No user authentication (anyone can message the bot)
- No chat context awareness (group vs DM)
- No user identity mapping to Supabase
- Config only has `bot_token`

## Changes

### 1. Config Schema (`src/config/schemas.ts`)

Add to `TelegramChannelConfigSchema`:
```
owner_user_id: z.string().optional()
partner_user_id: z.string().optional()
```

### 2. Telegram Channel (`src/channels/telegram.ts`)

- Accept `ownerUserId` and `partnerUserId` in config
- **User filtering**: In the text handler, reject messages from unauthorized users with a polite message. In group chats, only respond to messages from authorized users (silently ignore others).
- **Chat context detection**: Determine if message is from a group chat (chat.type === "group" or "supergroup") or a DM (chat.type === "private"). For DMs, determine if it's the owner or partner based on `from.id`.
- **Metadata enrichment**: Add `chatContext` ("group" | "dm_owner" | "dm_partner") and `userId` to inbound message metadata. This flows through to memory operations and evolution observations.
- **Conversation ID format**: `telegram:{chatId}` (unchanged — chat ID naturally distinguishes the three contexts)

### 3. User Identity (`src/channels/telegram-users.ts`, new file)

- `ensureUser(db, telegramUserId, role)` — Upserts into Supabase `users` table on first message
- Called once per user on first inbound message, cached after that
- Returns the internal UUID for the user

### 4. Index.ts Wiring

- Pass `ownerUserId` and `partnerUserId` from env vars through channel config
- Wire user identity lookup into message handling

### 5. Slack Disable

- Channels config already makes Slack optional (only enables with bot_token + app_token)
- No code changes needed — just don't set Slack env vars

## Acceptance Criteria

- [ ] AC-2.1: Bot only responds to messages from `OWNER_TELEGRAM_USER_ID` and `PARTNER_TELEGRAM_USER_ID`
- [ ] AC-2.2: Unauthorized users in DMs get a polite rejection message
- [ ] AC-2.3: Unauthorized users in group chats are silently ignored
- [ ] AC-2.4: Inbound messages include `chatContext` in metadata ("group", "dm_owner", or "dm_partner")
- [ ] AC-2.5: Inbound messages include `userId` (Telegram user ID) in metadata
- [ ] AC-2.6: First message from each authorized user creates a record in the Supabase `users` table
- [ ] AC-2.7: /start command responds with DUSTIN introduction (not "Phantom")
- [ ] AC-2.8: All existing Telegram tests pass
- [ ] AC-2.9: New tests cover user filtering, chat context detection, and user identity
- [ ] AC-2.10: Bot works in all three contexts: group chat, owner DM, partner DM

## Test Strategy

- Mock Telegraf (existing pattern in telegram.test.ts)
- Mock Supabase for user identity
- Test authorized/unauthorized user filtering in DM and group contexts
- Test chat context detection for all three contexts
