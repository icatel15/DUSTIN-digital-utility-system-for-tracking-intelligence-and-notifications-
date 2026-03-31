# Security Hardening Plan — Final Sign-Off Document

**Date:** 2026-03-31
**Status:** Implemented — all 5 findings remediated (commit `d5ce1be`)
**Scope:** 5 findings from external security review of HEAD (commit `3e521cc`)

---

## Overview

An external security review identified 5 vulnerabilities across the HTTP server, MCP layer, secrets UI, webhook channel, and Slack integration. This document captures the agreed remediation plan after three rounds of review between the implementation team and the security reviewer.

All fixes stay within the existing architecture. No new dependencies are introduced.

---

## Finding 1: Unauthenticated POST /trigger (Critical)

**Root cause:** `handleTrigger()` in `src/core/server.ts:144` accepts requests with no authentication. The agent runtime at `src/agent/runtime.ts:137-138` runs with `permissionMode: "bypassPermissions"`. Port 3100 is published externally in `docker-compose.yaml:14`.

**Impact:** Any network caller can submit arbitrary agent tasks and receive results.

### Remediation

| Change | File(s) | Detail |
|--------|---------|--------|
| Bearer token auth | `src/core/server.ts` | Require `TRIGGER_SECRET` env var. Compare with `timingSafeEqual`. |
| Feature-disabled response | `src/core/server.ts` | Return 404 (not 503) when `TRIGGER_SECRET` is unset. |
| Rate limiting | `src/core/server.ts` | Reuse existing `RateLimiter` from `src/mcp/rate-limiter.ts`. Single `"trigger"` bucket is acceptable as stopgap; per-source keying is a future improvement if multiple callers exist. |
| Durable audit logging | `src/core/server.ts`, `src/core/server.ts` (TriggerDeps type), `src/index.ts` | Wire `AuditLogger` into `TriggerDeps`. Persist to `mcp_audit` table (not `audit_log`). Log metadata only: source, conversationId, delivery target, task length, task hash. **Do not persist raw task text** — it may contain secrets or sensitive prompts. Log rejected auth attempts without parsing body. |
| Localhost-only port binding | `docker-compose.prod.yaml` (new override) | Bind `127.0.0.1:${PORT:-3100}:3100` in production override only. Do not change base `docker-compose.yaml`. |
| Deploy workflow update | `.github/workflows/deploy.yml` | Health check probes via `localhost` or Docker internal network, not `${{ secrets.VPS_HOST }}:3100`. |
| Documentation | `docs/reference/architecture.md` | Document reverse-proxy dependency for production. |

**Reviewer note:** `console.warn`/`console.log` is operational logging, not audit. The `AuditLogger` write is the durable record. If rate limits are later keyed off `x-forwarded-for`, only trust it behind a known proxy.

---

## Finding 2: MCP Scopes Defined But Never Enforced (Critical)

**Root cause:** `src/mcp/auth.ts` defines `hasScope()`, `getRequiredScope()`, and `TOOL_SCOPES`, but `src/mcp/server.ts:180` passes auth to the transport layer which drops it before tool execution. The MCP SDK transport does not propagate auth context into tool handlers.

**Impact:** A read-only dashboard token can register shell handlers and execute arbitrary commands.

### Remediation

| Change | File(s) | Detail |
|--------|---------|--------|
| Default deny for unknown tools | `src/mcp/auth.ts` | Change `getRequiredScope()` fallback from `"read"` to `"admin"`. Unknown tool names (including all dynamic tools) require admin. |
| Complete scope map | `src/mcp/auth.ts` | Explicitly map all 17 built-in tools across `tools-universal.ts` and `tools-swe.ts`. Full map: |

```
phantom_ask: "operator"
phantom_status: "read"
phantom_memory_query: "read"
phantom_task_create: "operator"
phantom_task_status: "read"
phantom_config: "read"
phantom_history: "read"
phantom_metrics: "read"
phantom_register_tool: "admin"
phantom_unregister_tool: "admin"
phantom_list_dynamic_tools: "read"
phantom_codebase_query: "read"
phantom_pr_status: "read"
phantom_ci_status: "read"
phantom_review_request: "operator"
phantom_deploy_status: "read"
phantom_repo_info: "read"
```

| Change | File(s) | Detail |
|--------|---------|--------|
| Transport-layer scope check | `src/mcp/transport.ts` | Store `AuthResult` per session. Before delegating POST requests to existing sessions, parse JSON body; if method is `tools/call`, extract tool name and call `hasScope()`. Return JSON-RPC error -32001 with 403 if scope is insufficient. |
| Session-to-client binding | `src/mcp/transport.ts` | Store `clientName` from original auth in `SessionEntry`. Reject requests where the authenticated client name doesn't match the session's original client. Prevents leaked session IDs from being reused across tokens. |
| Pass AuthMiddleware to transport | `src/mcp/server.ts` | `McpTransportManager` constructor takes `authMiddleware: AuthMiddleware` as second parameter. |

**Non-blocking future consideration:** If scope separation is needed beyond tools, also gate `resources/read` as requiring at least `read` scope.

---

## Finding 3: Secret Store Session Scoping (High)

**Root cause:** Sessions created via magic link in `src/ui/serve.ts:180` are generic — not bound to any specific secret request. Any valid session can view and submit secrets for any pending request. `src/secrets/store.ts:128` accepts undeclared secret field names.

**Impact:** One valid UI session plus a known requestId is enough to overwrite unrelated stored secrets.

### Remediation

| Change | File(s) | Detail |
|--------|---------|--------|
| Bound session constructor | `src/ui/session.ts` | Add `createBoundSession(requestId)` that stores the `requestId` in the session. Keep existing `createSession()` for generic UI login (with `requestId: null`). Add `getSessionRequestId(token)` accessor. |
| Bind on magic link exchange | `src/ui/serve.ts:180` | Call `createBoundSession(requestId)` instead of `createSession()`. |
| Single-use magic-link consumption | `src/ui/serve.ts`, `src/secrets/store.ts`, `supabase/migrations/*` | Consume the magic token on first successful exchange for a bound session. Prevent replay within the original TTL by marking the token used or removing the stored hash after first use. |
| Validate binding on form access | `src/ui/serve.ts:191` | Check `getSessionRequestId()` matches the URL's requestId. Return 403 if mismatched. |
| Validate binding on save | `src/ui/serve.ts:94` | Same requestId binding check before `handleSecretSave()`. |
| Reject undeclared fields | `src/secrets/store.ts:128` | Throw error if submitted field name is not in `request.fields`. |
| Enforce required fields | `src/secrets/store.ts` | Before saving, check all `required: true` fields have non-empty values. Throw with list of missing field names. |
| Reject empty submissions | `src/secrets/store.ts` | Do not mark request completed if `saved.length === 0`. Throw error. |

---

## Finding 4: Webhook Callback SSRF (Medium)

**Root cause:** `src/utils/url-validator.ts:9` validates URLs by checking literal hostname strings only. No DNS resolution occurs, so hostnames resolving to internal IPs bypass the blocklist. Fetch follows redirects by default.

**Impact:** A caller with the webhook HMAC secret can route server-side requests to RFC1918 or metadata addresses via DNS rebinding or redirect chains.

### Remediation

| Change | File(s) | Detail |
|--------|---------|--------|
| Async DNS validation | `src/utils/url-validator.ts` | Add `isSafeCallbackUrlAsync()`. Use `dns.lookup(hostname, { all: true, verbatim: true })` for full IPv4+IPv6 coverage. Check every resolved address against `isPrivateIp()` and `BLOCKED_METADATA_IPS`. |
| IPv4-mapped IPv6 handling | `src/utils/url-validator.ts` | In `isPrivateIp()`, detect `::ffff:` prefix and recurse on the embedded IPv4 address. |
| Explicit metadata IP blocklist | `src/utils/url-validator.ts` | Block `169.254.169.254` (AWS/GCP), `100.100.100.200` (Alibaba), `fd00:ec2::254` (AWS IPv6). |
| Cloud metadata hostnames | `src/utils/url-validator.ts` | Block `metadata.azure.com`, `metadata.azure.internal` in addition to existing Google entries. |
| Disable redirect following | `src/channels/webhook.ts` | Set `redirect: "manual"` on the `fetch()` call in `sendCallback()`. If a callback returns 3xx, treat it as failure and log it. Do not silently follow. |
| Re-validate at fetch time | `src/channels/webhook.ts` | Call `isSafeCallbackUrlAsync()` again in `sendCallback()` before the fetch. This is defense-in-depth, not complete DNS-rebinding protection. |
| Switch acceptance-time validation | `src/channels/webhook.ts:173` | Replace `isSafeCallbackUrl()` with `isSafeCallbackUrlAsync()`. |
| Export `isPrivateIp` | `src/utils/url-validator.ts` | Export so both sync and async paths can use it. |

**Known limitation:** Full DNS rebinding protection requires IP pinning at connect time (custom fetch agent that resolves once and connects to that exact IP). The double-check approach here raises the bar significantly but is documented as defense-in-depth, not a complete solution.

---

## Finding 5: Slack Action Owner Bypass (Medium)

**Root cause:** `src/channels/slack-actions.ts` registers Bolt action handlers at the app level without access to the `SlackChannel` instance's `isOwner()` method. `src/channels/slack.ts:380` `reaction_added` handler also lacks an owner check.

**Impact:** Any workspace member in a shared channel can trigger agent follow-up actions via button clicks or influence feedback via reactions.

### Remediation

| Change | File(s) | Detail |
|--------|---------|--------|
| Owner callback parameter | `src/channels/slack-actions.ts` | `registerSlackActions(app, isOwner?)` accepts an optional `OwnerChecker` callback `(userId: string) => boolean`. Both the feedback handler (line 38) and agent action handler (line 93) call it before processing. Non-owner clicks are logged and silently dropped. |
| Pass isOwner at registration | `src/channels/slack.ts` | Call `registerSlackActions(this.app, (userId) => this.isOwner(userId))`. |
| Owner gate on reactions | `src/channels/slack.ts:380` | Add `if (!this.isOwner(event.user)) return;` at the top of the `reaction_added` handler. This is already inside the `SlackChannel` class, so `this.isOwner()` is directly available. |

---

## Implementation Order

| Priority | Finding | Complexity | Status |
|----------|---------|------------|--------|
| 1 | Finding 1: `/trigger` auth | Low | [x] Done |
| 2 | Finding 2: MCP scope enforcement | Medium | [x] Done |
| 3 | Finding 5: Slack owner gating | Low | [x] Done |
| 4 | Finding 3: Secret session scoping | Low | [x] Done |
| 5 | Finding 4: Webhook SSRF | Medium | [x] Done |

All findings implemented in commit `d5ce1be` (2026-03-31). 943 tests passing (139 new).

---

## Test Requirements

Each finding requires tests before merge:

1. **Trigger:** Test 404 when `TRIGGER_SECRET` is unset; rejected without bearer token; rejected with wrong token; accepted with correct token; rate-limited after burst; accepted request writes an `mcp_audit` row; rejected auth attempt writes an audit row; audit entry stores metadata only and does not contain raw `task` text.
2. **MCP scopes:** Test read token can access read tools but is blocked from operator/admin tools; operator token can access operator/read tools but is blocked from admin tools; admin token is allowed everywhere; unknown tool name requires admin; dynamic tools require admin; existing session reused by a different client is rejected.
3. **Secrets:** Test bound session can only access its own `requestId`; session bound to another request is rejected; generic UI session cannot save a bound secret request; undeclared field names are rejected; missing required fields are rejected; empty submission does not complete request; failed validation leaves the request pending; the same magic link cannot be exchanged twice.
4. **Webhook SSRF:** Test literal private IPv4 is rejected; private or link-local IPv6 is rejected; IPv4-mapped IPv6 such as `::ffff:10.0.0.1` is rejected; metadata IPs such as `169.254.169.254`, `100.100.100.200`, and `fd00:ec2::254` are rejected; blocked metadata hostnames are rejected; hostname resolving to private or metadata IP is rejected; redirect response is treated as failure with `redirect: "manual"`; fetch-time re-validation rejects when DNS answers change between acceptance and send.
5. **Slack:** Test non-owner feedback button click is dropped; non-owner agent action click is dropped; non-owner reaction is dropped; owner button clicks and reactions are processed normally; behavior remains unchanged when no owner is configured, if that mode is still supported.

---

## Implementation Notes

- Finding 3 required two review rounds: initial implementation allowed generic UI sessions to bypass binding (null requestId passed the guard). Fixed by requiring exact `boundRequestId === requestId` match. Magic-link consumption changed from two-step validate+consume to atomic CAS UPDATE. Migration `20260331000003_secret_magic_token_used.sql` adds the `magic_token_used` column.
- Production port binding (`docker-compose.prod.yaml`) requires a reverse proxy for external HTTPS — documented in `docs/reference/architecture.md`.
- Finding 4 documents a known limitation: full DNS rebinding protection requires IP pinning at connect time. The double-check (acceptance + fetch-time validation) raises the bar but is defense-in-depth, not complete.

## Sign-Off

| Role | Name | Status | Date |
|------|------|--------|------|
| Security reviewer | | Code reviewed, no blocking findings | 2026-03-31 |
| Implementation lead | | Implemented | 2026-03-31 |
| Project owner | | Pending | |
