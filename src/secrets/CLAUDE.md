# src/secrets/ -- Encrypted secret management

Handles secure collection, encryption, storage, and retrieval of user credentials. Secrets are collected via magic-link web forms, encrypted with AES-256-GCM, and stored in Supabase.

Universal rules are governed by the root `CLAUDE.md`.

## File Inventory

| File | Purpose |
| --- | --- |
| `crypto.ts` | AES-256-GCM encrypt/decrypt functions. Resolves the encryption key from `SECRET_ENCRYPTION_KEY` env var or auto-generates one at `data/secret-encryption-key` |
| `store.ts` | Secret request lifecycle: `createSecretRequest`, `validateMagicToken`, `validateAndConsumeMagicToken` (atomic CAS), `saveSecrets`, `getSecret`. Also defines `SecretField` and `SecretRequest` types |
| `tools.ts` | MCP tool server with `phantom_collect_secrets` (create collection form) and `phantom_get_secret` (retrieve stored secret) |
| `form-page.ts` | Server-rendered HTML for the secret collection form. DaisyUI/Tailwind styling, dark/light theme, password visibility toggle. Also renders an expired-link page |

## How Secrets Are Stored and Retrieved

1. Agent calls `phantom_collect_secrets` with field definitions and a purpose string.
2. `createSecretRequest()` creates a DB row in `secret_requests` with a SHA-256 hashed magic token. Returns a magic-link URL.
3. User opens the magic link, which renders `secretsFormHtml()` with the defined fields.
4. On form submission, `saveSecrets()` validates required fields and undeclared field names, encrypts each value with `encryptSecret()`, and upserts into the `secrets` table.
5. Agent retrieves secrets via `phantom_get_secret` which calls `getSecret()`, decrypts the value, and updates access audit fields (`last_accessed_at`, `access_count`).

## Session Scoping and Security

- Magic tokens are SHA-256 hashed before storage; the plaintext is never persisted.
- `validateAndConsumeMagicToken()` uses an atomic UPDATE (compare-and-swap) so two concurrent callers cannot both succeed.
- Magic tokens have a 10-minute TTL (`MAGIC_TOKEN_TTL_MS`).
- Secret form sessions are bound to a specific `requestId` -- a generic UI session cannot access another request's form.
- The `magic_token_used` flag prevents token replay.

## Encryption

- Algorithm: AES-256-GCM with 12-byte IV and 16-byte auth tag.
- Key resolution: `SECRET_ENCRYPTION_KEY` env var (64 hex chars) takes precedence; otherwise auto-generates and persists to `data/secret-encryption-key` with mode 0600.
- Key is cached in memory after first resolution (`resetKeyCache()` for tests).

## Access Control

- Undeclared field names in submissions are rejected.
- Required fields must be non-empty.
- Empty submissions (no secrets provided) are rejected.
- Access audit: each `getSecret()` call increments `access_count` and updates `last_accessed_at`.

## Dependencies

- `@anthropic-ai/claude-agent-sdk` -- MCP tool server creation
- `zod` -- field schema validation
- `src/db/connection.ts` (`SupabaseClient`) -- persistence
- Node.js `crypto` -- AES-256-GCM, SHA-256, random bytes

## Update Protocol

Update this file when changing encryption algorithms, adding new tool actions, modifying the secret request lifecycle, or changing session scoping rules.
