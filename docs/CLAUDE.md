# docs/ — Project Documentation

Project documentation — specs, guides, references, and status tracking. No runtime dependencies; purely developer/agent reference material.

Universal rules (DFD, TDD, code style, agent behaviour) are governed by the root `CLAUDE.md`.

## Subdirectory Taxonomy

| Directory | Purpose | Contents |
|-----------|---------|----------|
| `specs/` | **What to build** — feature specifications with acceptance criteria | Phase specs, hardening plans |
| `guides/` | **How to do things** — step-by-step instructions and explanations | Getting started, channel setup, memory, MCP, roles, evolution, CI/CD |
| `reference/` | **Lookup material** — facts about the system as it exists today | Architecture, schema, tech stack, conventions, glossary, directory, security |
| `status/` | **Project tracking** — phase progress, decisions, deviations | index.md, open-decisions.md, per-phase status files |
| `archive/` | **Superseded docs** — kept for historical reference only | Pre-Phase 1 deployment docs |
| `assets/` | **Media** — images, SVGs, GIFs used in docs and README | phantom.svg, story screenshots |

## When to Create vs Update

- **New feature or phase** -- create a new spec in `specs/`.
- **New how-to or setup guide** -- create in `guides/`.
- **System facts changed** (schema, stack, architecture) -- update the existing file in `reference/`.
- **Document is superseded** -- move to `archive/` and add a deprecation notice at the top.
- **Phase completed or decision made** -- update the relevant file in `status/`.

## Cross-Reference Conventions

- Links between files in the **same subdirectory**: use bare filenames (`[channels](channels.md)`).
- Links between files in **different subdirectories**: use relative paths with `../` (`[security](../reference/security.md)`).
- Links from **outside docs/** (README.md, CLAUDE.md): use full repo-relative paths (`docs/guides/getting-started.md`).
- Status files linking to specs: `../specs/phase-1-data-layer-swap.md`.

## Update Protocol

Update this file when:
- Adding, removing, or renaming a subdirectory under `docs/`.
- Changing the taxonomy rules (what goes where).
- Changing cross-reference conventions.
