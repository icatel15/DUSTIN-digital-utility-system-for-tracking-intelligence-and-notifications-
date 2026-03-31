# Phase 2 — Telegram + Two-User Support

**Status**: Complete
**Started**: 2026-03-31
**Completed**: 2026-03-31

## Deliverables

- [x] Telegram channel with user filtering (authorized users only)
- [x] Chat context detection (group / dm_owner / dm_partner)
- [x] User identity module (ensureUser → Supabase users table)
- [x] Config schema updated (owner_user_id, partner_user_id)
- [x] System prompt customized for DUSTIN (household model, Woody + Tash, no Slack refs)
- [x] Telegram send fix (MarkdownV2 fallback to plain text)
- [x] Telegraf launch fix (fire-and-forget, never awaited — infinite polling loop)
- [x] Deployed to Hetzner VPS with systemd
- [x] 804 tests passing (15 new for telegram-users)

## Decisions

**D-2.01** (2026-03-31): Telegraf launch() is fire-and-forget, not awaited.
- Context: Telegraf's `launch()` starts an infinite async iterator polling loop — it never resolves.
- Decision: Call `launch()` without await, set connected after 500ms delay.
- Rationale: The original Phantom code had the same issue masked by different startup ordering.

**D-2.02** (2026-03-31): systemd service needs EnvironmentFile + HOME env var.
- Context: Claude Agent SDK spawns the `claude` CLI as a subprocess. It needs ANTHROPIC_API_KEY and HOME.
- Decision: Added `EnvironmentFile=/home/dustin/app/.env` and `Environment=HOME=/home/dustin` to systemd unit.
- Rationale: systemd doesn't load .env or set HOME by default for service users.

**D-2.03** (2026-03-31): Open mode when no user IDs configured.
- Context: During development, requiring user IDs would block testing.
- Decision: If neither OWNER_TELEGRAM_USER_ID nor PARTNER_TELEGRAM_USER_ID is set, all users are allowed.
- Rationale: Matches Phantom's Slack behavior (owner_user_id optional).

## Deviations

**V-2.01**: Base file Phase 2 included "Disable Slack channel via feature flag" — not needed since channels.yaml simply doesn't enable Slack. No feature flag code required.

**V-2.02**: Base file said "Adapt onboarding flow from Slack DM to Telegram" — deferred. The onboarding prompt injects into the system prompt and works channel-agnostically. Telegram-specific onboarding UX (inline keyboards for questions) can be added later.
