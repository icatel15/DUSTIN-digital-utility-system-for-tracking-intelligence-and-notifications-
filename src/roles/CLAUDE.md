# src/roles/ -- Agent role system for specialization

Defines the role framework that shapes agent identity, capabilities, communication style, and tool availability. Roles are configured in YAML (`config/roles/`) and optionally extended with TypeScript modules in this directory.

Universal rules are governed by the root `CLAUDE.md`.

## File Inventory

| File | Purpose |
| --- | --- |
| `types.ts` | Zod schemas and TypeScript types for `RoleConfig`, `RoleTemplate`, `RoleModule`, `RoleToolRegistration`, and supporting types (`OnboardingQuestion`, `EvolutionFocus`, `InitialConfig`, `McpToolDefinition`) |
| `loader.ts` | Loads and validates YAML role configs from `config/roles/`, builds the `systemPromptSection` string, lists available roles |
| `registry.ts` | `RoleRegistry` class -- in-memory store for loaded roles and modules. Provides lookup, listing, onboarding questions, evolution focus. `createRoleRegistry()` factory loads all available roles |
| `base.ts` | Base role module -- minimal reference implementation with no custom tools |
| `swe.ts` | SWE role module -- marker module indicating the SWE role has custom tools (actual implementations live in `src/mcp/tools-swe.ts`) |

## Role Configuration Structure (YAML)

Each role is a YAML file in `config/roles/{roleId}.yaml` validated against `RoleConfigSchema`:

- `id`, `name`, `description` -- identity metadata
- `identity` -- persona description injected into system prompt
- `capabilities` -- array of capability strings rendered as a bullet list
- `communication` -- communication style directive for the system prompt
- `onboarding_questions` -- questions asked during user onboarding (type: text/choice/multiline)
- `mcp_tools` -- MCP tool definitions (name + description) the role exposes
- `evolution_focus` -- priorities and feedback signals for self-improvement
- `initial_config` -- persona, domain knowledge, task patterns, tool preferences defaults

## Role Loader and Registry Pattern

1. `loadRoleFromYaml(roleId)` reads `config/roles/{roleId}.yaml`, parses with `yaml`, validates with Zod, and appends a `systemPromptSection` built from identity + capabilities + communication.
2. `RoleRegistry` stores `RoleTemplate` (config + prompt section) and optional `RoleModule` (custom tools) per role ID.
3. `createRoleRegistry()` scans `config/roles/`, loads all YAML files, and returns a populated registry.
4. `getTools(roleId)` returns the custom `RoleToolRegistration[]` from the module, if any.

## How Roles Affect Agent Behavior

- **System prompt**: `systemPromptSection` is injected into the agent's system prompt (identity, capabilities, communication style).
- **Tools**: Each role can declare `mcp_tools` (MCP tool definitions) and provide a TypeScript module with `RoleToolRegistration[]` handlers.
- **Evolution**: `evolution_focus.priorities` and `feedback_signals` guide the agent's self-improvement direction.
- **Onboarding**: `onboarding_questions` drive the initial user setup flow.

## How to Add a New Role

1. Create `config/roles/{roleId}.yaml` matching `RoleConfigSchema`.
2. Optionally create `src/roles/{roleId}.ts` exporting a `RoleModule` with custom tools.
3. Register the module in the registry if it has tools (the YAML is auto-discovered).

## Dependencies

- `yaml` -- YAML parsing
- `zod` -- schema validation
- No database or network dependencies; pure config loading

## Update Protocol

Update this file when adding new role modules, changing the `RoleConfig` schema, or modifying the loader/registry pattern.
