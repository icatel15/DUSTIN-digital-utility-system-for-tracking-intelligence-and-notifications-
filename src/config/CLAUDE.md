# src/config/ — YAML Config Loading with Zod Validation

Loads and validates YAML configuration files, exporting typed config objects for the rest of the application.

Universal rules are governed by the root `CLAUDE.md`.

## Module Inventory

| File | Responsibility |
|---|---|
| `loader.ts` | `loadConfig(path?)` and `loadChannelsConfig(path?)` — reads YAML, validates with Zod, applies env-var overrides. |
| `schemas.ts` | All Zod schemas: `PhantomConfigSchema`, `ChannelsConfigSchema` (Slack, Telegram, Email, Webhook), `MemoryConfigSchema`, `PeerConfigSchema`. |
| `types.ts` | Inferred types: `PhantomConfig`, `MemoryConfig` (derived from schemas via `z.infer`). |

## Export List

```ts
// loader.ts
loadConfig(path?: string): PhantomConfig          // Loads config/phantom.yaml
loadChannelsConfig(path?: string): ChannelsConfig | null  // Loads config/channels.yaml (returns null if missing)

// schemas.ts
PhantomConfigSchema       // name, domain, port, role, model, effort, max_budget_usd, timeout_minutes, peers
ChannelsConfigSchema      // slack?, telegram?, email?, webhook?
SlackChannelConfigSchema  // enabled, bot_token, app_token, default_channel_id, owner_user_id, delivery_allowlist
TelegramChannelConfigSchema
EmailChannelConfigSchema  // imap + smtp config
WebhookChannelConfigSchema // secret, sync_timeout_ms
MemoryConfigSchema        // qdrant, embeddings, collections, embedding dimensions, context limits
PeerConfigSchema          // url, token, description, enabled

// types.ts
type PhantomConfig        // z.infer<typeof PhantomConfigSchema>
type MemoryConfig         // z.infer<typeof MemoryConfigSchema>
```

## Config File Mapping

| YAML File | Schema | Loader | Notes |
|---|---|---|---|
| `config/phantom.yaml` | `PhantomConfigSchema` | `loadConfig()` | Required. Env-var overrides: `PHANTOM_MODEL`, `PHANTOM_DOMAIN`, `PHANTOM_NAME`, `PHANTOM_ROLE`, `PHANTOM_EFFORT`, `PORT`. |
| `config/channels.yaml` | `ChannelsConfigSchema` | `loadChannelsConfig()` | Optional. Supports `${ENV_VAR}` substitution in YAML values. |
| `config/mcp.yaml` | (validated in `src/mcp/config.ts`) | N/A — loaded by MCP module | Not handled by this module. |

## How to Add a New Config Section

1. Define the Zod schema in `schemas.ts`.
2. If it is a top-level config concept (not nested under an existing schema), add the inferred type to `types.ts`.
3. Add a loader function in `loader.ts` following the pattern: read file, parse YAML, validate with Zod, apply env-var overrides if needed.
4. Add tests in `__tests__/`.

## Update Protocol

Update this file when adding new schemas, changing validation rules, adding new YAML config files, or modifying the env-var override logic.
