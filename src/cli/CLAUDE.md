# src/cli/ — CLI Commands

Command-line interface for the Phantom agent. Invoked as `phantom <command>`.

Universal rules are governed by the root `CLAUDE.md`.

## Entry Point

`main.ts` is the shebang entry (`#!/usr/bin/env bun`). It calls `runCli()` from `index.ts` and exits with code 1 on error.

## Command Dispatch

`index.ts#runCli()` parses `process.argv`, matches the first positional argument against a command map, and lazily imports the handler module. Supports `--help`/`-h` and `--version`/`-v` at the top level.

## Command Inventory

| Command | File | Function | Description |
|---|---|---|---|
| `start` | `start.ts` | `runStart()` | Starts the Phantom agent. Supports `--port`, `--config`, `--daemon` (background via `Bun.spawn` with `unref()`). Foreground mode imports `../index.ts` directly. |
| `init` | `init.ts` | `runInit()` | Interactive (or `--yes` unattended) setup wizard. Creates `config/phantom.yaml`, `config/mcp.yaml`, `config/channels.yaml`, and `phantom-config/` directory with initial evolved config files. Generates MCP tokens (admin, operator, read). Supports env-var-driven defaults for CI/cloud-init. |
| `doctor` | `doctor.ts` | `runDoctor()` | Runs 9 health checks: Bun, Docker, Qdrant, Embeddings (OpenAI key), Config, MCP Config, Supabase, Evolved Config, Phantom Process. Outputs human-readable or `--json`. |
| `token` | `token.ts` | `runToken()` | Subcommands: `create` (generate new token with `--client` and `--scope`), `list` (show all tokens), `revoke` (remove by `--client`). Reads/writes `config/mcp.yaml`. |
| `status` | `status.ts` | `runStatus()` | Fetches `/health` from the running Phantom and prints a one-line summary (agent, role, version, generation, uptime, channels, memory, peers). Supports `--json`, `--port`, `--url`. |

## How to Add a New Command

1. Create `src/cli/<command>.ts` exporting `async function run<Command>(args: string[]): Promise<void>`.
2. Use `parseArgs()` from `node:util` for option parsing. Always support `--help`/`-h`.
3. Add the command to the `COMMANDS` record and the `switch` block in `index.ts`.
4. Add tests in `__tests__/`.

## Dependencies

- `node:util#parseArgs` — argument parsing (all commands)
- `node:readline#createInterface` — interactive prompts (`init`)
- `node:fs` — config file I/O (`init`, `token`, `doctor`)
- `yaml` — YAML parse/stringify (`init`, `token`)
- `../mcp/config.ts#hashTokenSync` — token hashing (`init`, `token`)
- `../mcp/types.ts#McpScope` — scope type (`token`)
- `../config/loader.ts#loadConfig` — config validation (`doctor`)
- `../db/connection.ts#getDatabase` — Supabase connectivity check (`doctor`)

## Update Protocol

Update this file when adding, removing, or renaming CLI commands, or when changing the argument parsing conventions.
