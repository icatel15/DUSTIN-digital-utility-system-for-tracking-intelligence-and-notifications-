# Phase 8 — Multi-Model Routing

## Overview

DUSTIN currently runs a single model (Haiku) for all interactions — chat, scheduled jobs, tool creation, and system configuration. Haiku is fast and cheap but produces low-quality code and misses security issues when building tools or designing systems.

This phase introduces a two-mode architecture: **chat mode** (Haiku) for everyday conversation and task execution, and **build mode** (Sonnet) for complex work requiring higher reasoning — tool creation, code generation, scheduled job design, and system configuration. The user-facing model (Haiku) detects when a task exceeds its capability and hands the conversation directly to Sonnet, which communicates with the user without a translation layer.

## Design Principles

1. **Capable thinker, cheap doer.** Intelligence goes into planning and building. Execution of well-structured tasks (running briefings, formatting output, casual chat) stays cheap.
2. **No lossy translation.** Sonnet talks directly to the user. Haiku never summarises or relays Sonnet's output.
3. **User stays in control.** Mode switches are visible, overridable, and never happen autonomously without user awareness.
4. **Present before activate.** Build mode always presents work for user approval before making changes live.

## Modes

| Mode | Indicator | Model | Purpose |
|------|-----------|-------|---------|
| Chat | `[chat]` | Haiku | Conversation, briefings, quick lookups, scheduled job execution, status checks |
| Build | `[build]` | Sonnet | Tool registration, code generation, scheduled job design, system config changes |

Every Telegram message from DUSTIN is prefixed with the current mode indicator.

## Mode Switching

### Automatic Detection (Chat -> Build)

Haiku detects that an incoming message requires build mode based on intent classification. Triggers:

- User asks to create, modify, or fix a dynamic tool
- User asks to create or redesign a scheduled job prompt
- User asks for code generation or system configuration changes
- User asks to modify DUSTIN's own behaviour, prompts, or architecture

When Haiku detects a build-worthy task, it:

1. Announces the mode switch: `[chat] Switching to build mode for this.`
2. Hands the conversation to Sonnet
3. Sonnet picks up with `[build]` prefix and engages the user directly

### Manual Override

The user can force a mode switch at any time:

- `build mode` or `switch to build` — enters build mode
- `chat mode` or `switch to chat` — returns to chat mode
- `stay in build mode` — prevents auto-drop after task completion

### Build -> Chat (Completion)

Build mode is **sticky to task completion**, not time-based. Sonnet stays active until:

- The build task is completed and approved by the user
- The user explicitly switches back to chat mode
- The user says the task is done or abandoned

Build mode does **not** auto-drop on inactivity. A user can leave for 20 minutes and return to the same build context.

### Casual Interrupts During Build

If the user sends a casual message during an active build (e.g., "how did Arsenal do?"), DUSTIN handles it in chat mode without losing build context. The build task remains in progress in the background. When the user returns to the build topic, Sonnet resumes.

## Multi-Turn Build Conversations

Build mode supports stateful multi-turn conversations. Sonnet can:

- Ask clarifying questions and wait for user responses
- Present intermediate results for feedback
- Iterate on designs based on user input
- Present final work for approval before activation

This means build mode sessions maintain their own conversation context across multiple messages, separate from the chat mode session.

## Approval Gate

Before any build mode action takes effect, Sonnet must present the result and wait for explicit user approval:

- **Tool registration**: Show the full tool definition (name, description, input schema, handler code) and ask "Ready to register this?"
- **Scheduled job creation**: Show the full job config (schedule, prompt, delivery) and ask "Ready to activate this?"
- **Config changes**: Show the diff and ask "Apply these changes?"

Nothing is registered, activated, or applied until the user confirms.

## Self-Escalation Policy

DUSTIN cannot enter build mode on its own initiative. If a scheduled job fails and the fix requires code changes, or a tool is broken and needs repair, DUSTIN:

1. Detects the issue in chat mode
2. Flags it to the user: `[chat] The parallel_search tool is returning errors. This needs a fix in build mode. Want me to switch?`
3. Waits for user confirmation before escalating

No autonomous Sonnet usage. No surprise costs.

## Sonnet Unavailability

If Sonnet is unavailable (API outage, rate limit), DUSTIN refuses to enter build mode:

`[chat] Can't enter build mode right now — Sonnet is unavailable. I'll let you know when it's back.`

Haiku does **not** attempt build tasks in degraded mode. The user is informed and can retry later.

## Cost Model

- **Chat mode (Haiku)**: Handles ~95% of interactions. Cheap.
- **Build mode (Sonnet)**: ~15x cost per token. Used only for complex tasks.
- **Monitoring only**: No hard budget limits. Cost tracked via existing `cost_events` table with model attribution. User monitors via dashboard or `phantom_metrics`.

---

## Implementation

### Existing State

- `AgentRuntime.handleMessage()` uses `this.config.model` for all queries (`src/agent/runtime.ts:136`)
- `PhantomConfigSchema` has a single `model` field defaulting to `claude-haiku-4-5` (`src/config/schemas.ts:15`)
- Sessions tracked in `sessions` table with `sdk_session_id` for resume
- Cost tracking already records per-model usage via `modelUsage` in `cost_events`
- Telegram channel dispatches messages through `ChannelRouter` -> `AgentRuntime`

### Changes

#### 1. Mode State on Sessions

Add `mode` column to the `sessions` table:

```sql
ALTER TABLE sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'chat';
-- Values: 'chat', 'build'
```

Add `build_task_summary` column to track what the build session is working on:

```sql
ALTER TABLE sessions ADD COLUMN build_task_summary TEXT;
-- Null when in chat mode. Short description when in build mode.
```

Update `SessionStore` to read/write mode state.

#### 2. Model Router (`src/agent/model-router.ts`)

New module that decides which model to use for a given message.

```typescript
type RoutingDecision = {
  model: string;           // e.g., "claude-sonnet-4-5" or "claude-haiku-4-5"
  mode: "chat" | "build";
  reason: string;          // Why this mode was selected
  modeChanged: boolean;    // Whether this message triggered a mode switch
};

function routeMessage(
  currentMode: "chat" | "build",
  messageText: string,
  manualOverride?: "chat" | "build",
): RoutingDecision;
```

**Routing logic:**

1. If `manualOverride` is set, use it.
2. If `currentMode` is `build`, stay in build (sticky) unless user explicitly exits.
3. If `currentMode` is `chat`, classify the message:
   - Check for explicit mode commands (`build mode`, `chat mode`)
   - Check for build triggers (tool creation, code generation, job design, config changes)
   - Default to chat

**Build trigger detection** (initial implementation — keyword/intent matching):

- References to creating, building, fixing, or modifying tools
- References to writing code, scripts, or handlers
- References to creating or redesigning scheduled jobs/prompts
- References to system configuration, environment variables, restart
- References to DUSTIN modifying its own behaviour

This can be refined over time. False negatives (staying in chat for a build task) are safe — the user can manually switch. False positives (entering build mode unnecessarily) waste money but don't break anything.

#### 3. Casual Interrupt Detection

When in build mode, classify incoming messages as build-related or casual:

- If the message clearly continues the build topic, route to Sonnet
- If the message is unrelated (weather, news, Arsenal, greetings), handle in chat mode with Haiku and preserve the build session

Implementation: lightweight intent check — does the message reference the active `build_task_summary`? If not, treat as casual interrupt.

#### 4. Runtime Changes (`src/agent/runtime.ts`)

Modify `handleMessage()` to:

1. Load current session mode
2. Call `routeMessage()` to get the routing decision
3. If mode changed, update session state
4. Use the routed model in the `query()` call instead of `this.config.model`
5. If entering build mode, emit a mode-switch announcement
6. If handling a casual interrupt during build, use Haiku but don't clear build state

The key change is on line 136:

```typescript
// Before
model: this.config.model,

// After
model: routingDecision.model,
```

#### 5. Message Prefix (`src/channels/telegram.ts`)

Before sending any message to Telegram, prepend the mode indicator:

```typescript
const prefix = mode === "build" ? "[build] " : "[chat] ";
const prefixedText = `${prefix}${responseText}`;
```

Apply to all outbound messages on all channels (Telegram, Slack, webhook).

#### 6. Mode Switch Announcements

When mode changes, inject an announcement before the actual response:

- Chat -> Build: `[chat] Switching to build mode for this.`
- Build -> Chat: `[build] Task complete. Switching back to chat mode.`

#### 7. Build Mode Prompt Additions

When in build mode, append additional instructions to the system prompt:

```
## Build Mode Active

You are in build mode. You are using a more capable model for this task.

Rules:
- Always present your work for user approval before activating (registering tools, creating jobs, applying config changes).
- Show the complete artifact (full code, full prompt, full config diff) — do not summarise.
- Ask clarifying questions when requirements are ambiguous.
- When the task is complete and approved, announce that you're switching back to chat mode.
```

#### 8. Config Schema Update

Add build-mode model to config:

```typescript
export const PhantomConfigSchema = z.object({
  // ... existing fields
  model: z.string().min(1).default("claude-haiku-4-5"),
  build_model: z.string().min(1).default("claude-sonnet-4-5"),
});
```

With env override: `PHANTOM_BUILD_MODEL`.

---

## Acceptance Criteria

1. **Mode indicator**: Every outbound message is prefixed with `[chat]` or `[build]`.
2. **Auto-detection**: Asking DUSTIN to "build me a search tool" triggers build mode automatically.
3. **Manual override**: Sending "build mode" enters build mode; "chat mode" exits it.
4. **Sticky build**: Build mode persists across multiple messages until task completion or explicit exit.
5. **Direct communication**: In build mode, Sonnet responds directly — no Haiku summarisation.
6. **Approval gate**: Tool registration, job creation, and config changes require explicit user approval before activation.
7. **Casual interrupts**: A casual message during build mode is handled by Haiku without losing build context.
8. **No self-escalation**: DUSTIN flags build-worthy issues to the user rather than entering build mode autonomously.
9. **Graceful degradation**: If Sonnet is unavailable, DUSTIN refuses build mode with a clear message.
10. **Cost attribution**: `cost_events` records which model handled each turn, distinguishing chat vs build costs.

## Test Plan

### Tier 1: Unit Tests

- `model-router.ts`: routing logic — manual overrides, build trigger detection, sticky mode, casual interrupt classification
- Prefix injection: messages are correctly prefixed with mode indicator
- Build prompt additions: system prompt includes build-mode rules when active

### Tier 2: Integration Tests

- Session mode persistence: mode survives across multiple `handleMessage()` calls
- Model switching: verify the correct model ID is passed to `query()` based on mode
- Approval gate: tool registration is blocked until approval signal is received
- Casual interrupt: build session state preserved after a chat-mode interrupt
- Sonnet unavailability: build mode refused with appropriate error message

### Tier 3: External Integration Tests

- End-to-end Telegram flow: send a build request, verify mode switch announcement, verify `[build]` prefix, verify approval gate, verify return to chat mode
- Cost tracking: verify `cost_events` correctly attributes Sonnet vs Haiku costs across a mixed session
