# CLAUDE.md — Master Template

This file governs all agent behaviour in this project: session rules, documentation navigation, development methodology, code style, and domain conventions. It is loaded into every agent's system prompt automatically.

This root file contains universal rules that apply to every task. Project-specific context — architecture, tech stack, schema, conventions, and terminology — lives in dedicated files under `docs/` (see the Project Documentation Suite in the Code Style & Conventions section). Folder-specific context lives in subfolder `CLAUDE.md` files (see the Sub-Folder Documentation section). All subfolder `CLAUDE.md` files should reference this root file for universal rules.

## Documentation-First Development (DFD)

No net-new feature or component may be implemented without prior documentation and user approval.

### Requirements Before Implementation

1. **Feature documentation exists**: A document or module in `docs/` covers the feature.
2. **User sign-off obtained**: The user has explicitly approved the scope and approach.
3. **Acceptance criteria defined**: Clear, testable criteria are agreed upon.
4. **Test requirements specified**: Testing approach is documented.

### When Documentation Is Required

- New features or components not currently in the codebase.
- New API endpoints, database tables, or schema changes.
- New algorithms, scoring logic, or processing pipelines.
- Changes affecting data flow between layers or services.
- Changes to prompt templates affecting output format or behaviour.

### When Documentation Is NOT Required

1. **Bug fixes**: Correcting behaviour to match existing documented acceptance criteria. If no documented expectation exists, it is a feature, not a bug — document first.
2. **Test additions**: Adding tests for existing documented functionality.
3. **Refactoring**: Internal code changes with no external behaviour change. All existing tests must continue to pass without modification.

### DFD Decision Rule

> "Does an approved document with acceptance criteria exist that explicitly covers this change?"

- **Yes** → Proceed within documented scope.
- **No** → Stop and request user guidance.

### Workflow

```text
1. PROPOSE    → Agent identifies need, proposes to user
2. DOCUMENT   → Create/update feature doc with scope, acceptance criteria, tests
3. REVIEW     → User reviews and approves (or requests changes)
4. IMPLEMENT  → Only after approval, begin TDD cycle (Red → Green → Refactor)
```

### Post-Implementation Doc Sync

After completing a feature or making significant changes, update the relevant `docs/` files to match what was actually built. Specs drift during implementation — field names change, types get restructured, new endpoints appear. A doc-sync pass ensures the specs remain accurate contracts, not traps for future developers or agents.

### Enforcement

- Agents must check for existing documentation before implementing.
- If no documentation exists, pause and request user guidance.
- Implementation without documentation approval is a process violation.
- User may request full rollback of unapproved changes.

## Test-Driven Development (TDD)

Every change ships with tests. No exceptions.

### Red → Green → Refactor

1. **Red**: Write a failing test that defines the expected behaviour.
2. **Green**: Write the minimal implementation to make the test pass.
3. **Refactor**: Clean up without changing behaviour. All tests still pass.

### Definition of Done

- Every change ships with a new or updated test.
- All tests pass locally before any commit.
- Schema changes, API contract changes, and algorithm changes are called out in the commit message.

### Test Tiers

#### Tier 1: Unit Tests

Fast, isolated, no I/O. Pure logic, transformations, calculations, output parsing. Everything external is mocked — databases, APIs, file systems, network. These run in milliseconds.

- Mock all external dependencies.
- Seed randomness. Any stochastic behaviour uses fixed seeds.
- Test outputs and behaviour, not implementation details.
- When mocking components, import and use the real component's prop types (e.g., `ComponentProps<typeof ConfirmDialog>`) rather than defining them inline. This ensures mocks break when the real interface changes.

#### Tier 2: Internal Integration Tests

Your code against your own infrastructure. Real database, real migrations, real security policies — but no external network calls.

- Use testcontainers for real Postgres instances. No in-memory substitutes (SQLite, etc.) that mask dialect differences.
- Test your API endpoints via test clients (httpx, supertest, etc.) against the real application stack.
- Verify RLS policies and permission boundaries explicitly. Every schema change affecting permissions must include tests verifying cross-user isolation.
- Test that your layers actually wire together — service → database, API → service, middleware → routes.
- These are slower than unit tests and that is fine. Correctness at the integration boundary is worth the seconds.

#### Tier 3: External Integration Tests

Your code against third-party services. Runs against sandboxes, staging environments, or test accounts.

- Verify your code works with the real API shape — authentication flows, token exchanges, webhook delivery, rate limit handling.
- Use dedicated test/sandbox accounts (Supabase staging project, Google test calendar, Stripe test mode, etc.).
- These tests may be slow, flaky, or require credentials. They should run separately from the main test suite (e.g., a dedicated CI job or manual trigger), not on every commit.
- Mock all external APIs in Tier 1 and Tier 2. Tier 3 is the only place real external calls are permitted.

#### Tier 4: End-to-End (Playwright)

Critical user workflows in a real browser. Applies to any project with a UI.

- Use Playwright as the standard E2E framework.
- Cover happy paths plus critical edge cases. Do not test every permutation.
- Focus on workflows that cross multiple pages or involve authentication, navigation, and data persistence.
- E2E tests are the most expensive to write and maintain. Be deliberate about what earns an E2E test — if it can be covered at a lower tier, it should be.

### Regression Safety

- Add a test before fixing any bug or refactoring any component.
- Golden output and golden dataset updates require explicit justification in the commit message.
- Never bulk-update golden test fixtures without individual inspection.

### Two-Attempt Rule

If a fix does not resolve the issue after 2 attempts, stop. Perform a root cause analysis and write it up before attempting further fixes. Prefer diagnostic investigation over trial-and-error.

## Domain Uncertainty Protocol

Projects involve APIs, regulatory frameworks, and domain-specific methodology that agents may not know with certainty.

### When to Pause

- The required API behaviour is not documented in project docs or verified against current API docs.
- A calculation or methodology requires domain-specific knowledge you cannot verify from the documentation.
- Integration mechanics (auth flows, webhook delivery, real-time subscriptions) are ambiguous.
- The correct handling of a domain-specific scenario is unclear.

### What to Do

1. State your current plan and the specific knowledge gaps.
2. Identify which project document or module might contain the answer.
3. If the answer is not in project docs, ask the user for clarification.
4. Propose consulting current API documentation or external sources and ask for approval before fetching.

### What NOT to Do

- Do not guess at API contracts, rate limits, or authentication flows.
- Do not invent calculation methodologies or business logic.
- Do not assume external service behaviour is stable across versions.
- Do not silently use placeholder values for domain-specific constants.

## Sub-Folder Documentation (CLAUDE.md Convention)

### Rule

Every meaningful directory in the project must have its own `CLAUDE.md` file. These are loaded automatically by Claude Code when working in that directory, keeping the root file lean while ensuring agents always have the right context for the folder they're in.

### Depth Rule

Not every nested folder needs its own file. Apply this test:

- **First-level directories** (e.g., `app/`, `components/`, `lib/`, `types/`, `supabase/`) — always get a CLAUDE.md.
- **Second-level directories** (e.g., `components/calendar/`, `lib/supabase/`, `app/(dashboard)/`) — get a CLAUDE.md when they represent a distinct feature, domain, or integration with their own conventions, dependencies, or non-obvious patterns.
- **Third-level and beyond** — only get a CLAUDE.md if they have genuinely distinct context that doesn't belong in the parent. This is rare.

**The fold-up rule**: If a subfolder's context can be covered in 5 lines or fewer, include it as a section in the parent folder's CLAUDE.md instead of creating a separate file. Avoid fragmenting context across many near-empty files — that forces agents to load multiple tiny files rather than one well-organised parent.

### When to Create a Subfolder CLAUDE.md

- When creating a new directory that will contain source code, configuration, or migrations.
- When a folder grows beyond 3-4 files with non-obvious relationships.
- When the folder has its own conventions, dependencies, or patterns that differ from its parent.
- Never for empty directories, build output, or dependency folders (`node_modules/`, `.next/`, `dist/`).

### When to Update a Subfolder CLAUDE.md

- When adding, removing, or renaming files in the folder.
- When changing exports, props patterns, or public interfaces.
- When modifying data dependencies or auth requirements.
- As part of the post-implementation doc sync (see DFD section).

### Required Content by Folder Type

#### Route Folders (`app/**/`, `pages/**/`, or equivalent)

- **Route purpose** — What page or feature this route serves.
- **Auth requirements** — Public, authenticated, or role-restricted.
- **Data dependencies** — What data is fetched, from where, and how (server vs client).
- **Key components used** — Which components render this route.

#### Component Folders (`components/`, `components/**/`)

- **Component inventory** — List of components with one-line descriptions.
- **Props patterns** — Common prop conventions (callback naming, boolean prefixes, spread patterns).
- **State management** — How state is handled (local, context, server state, URL state).
- **Styling approach** — Tailwind patterns, variant system, theming conventions.

#### Library / Utility Folders (`lib/`, `utils/`, `helpers/`)

- **Module purpose** — What utilities or clients this folder provides.
- **Export list** — Public functions and classes with signatures.
- **Usage examples** — How to import and use the key exports.
- **Side effects** — Any initialisation, global state, or connection creation.

#### Type / Schema Folders (`types/`, `schemas/`)

- **Type categories** — How types are grouped (database, API, UI, domain).
- **Naming conventions** — PascalCase for interfaces, SCREAMING_SNAKE for constants, etc.
- **Extension patterns** — How to extend base types for derived use cases.

#### Database Folders (`supabase/`, `prisma/`, `migrations/`)

- **Migration naming** — Timestamp format and naming rules.
- **Schema change process** — How to add tables, columns, policies.
- **Security patterns** — RLS conventions, permission model, role checks.
- **Testing migrations** — How to verify before applying.

#### API Folders (`api/`, `routes/`, `endpoints/`)

- **Route inventory** — List of endpoints with methods and one-line descriptions.
- **Auth patterns** — How authentication and authorisation are enforced.
- **Request/response conventions** — Validation, error format, pagination.
- **Shared middleware** — What middleware applies and in what order.

#### Service / Domain Logic Folders (`services/`, `domain/`)

- **Service inventory** — What each service is responsible for.
- **Dependencies** — What other services, databases, or external APIs each service uses.
- **Error handling** — How errors are classified and propagated.
- **Key business rules** — Domain logic that is not obvious from the code.

### General Requirements (All Subfolder CLAUDE.md Files)

- **Purpose** — One-line description of the folder's role. Always the first line.
- **Keep it concise** — Target 30-80 lines. This is a reference, not documentation. If it's growing beyond 100 lines, the folder may need splitting or the CLAUDE.md needs tightening.
- **No duplication** — Do not repeat rules from the root CLAUDE.md. Subfolder files document what is specific to that folder.
- **Reference root** — Include a note that universal rules are governed by the root `CLAUDE.md`. This ensures agents working in a subfolder do not miss the project-wide methodology.
- **Update protocol** — State when this file should be updated (e.g., "when adding new components" or "when changing the migration process").

## Agent Behaviour

### Parallel Agent Coordination

- Delegate independent work to agents running in parallel wherever possible to maximise speed of execution.
- Organise parallel agents by file ownership. No two agents should edit the same file.
- Use worktree isolation for agents writing code to avoid conflicts.
- After parallel agent work completes, always run the full test suite and fix any type errors or test failures introduced by overlapping edits before reporting success.

### Overrides & Conflict Resolution

- **CLAUDE.md** (root) is the source of truth for agent behaviour: development methodology, code style, workflow rules.
- **Spec docs** (`docs/`) are the source of truth for technical specifications: what gets built, how it works, data contracts, acceptance criteria.
- **Subfolder CLAUDE.md files** are the source of truth for folder-specific context: conventions, dependencies, patterns local to that directory.
- On conflict between CLAUDE.md and any other document: CLAUDE.md governs how agents work; spec docs govern what gets built.
- When guidance is missing, prefer the more conservative interpretation (more tests, stricter validation, ask before acting).
- Document any intentional deviations in the commit message.

## Status Tracking & Decision Logging

### Purpose

Track all implementation progress, architectural decisions, and deviations from specifications so that any agent — in any future session — can understand what was built, why, and what changed from the original plan.

### File Structure

```text
docs/status/
├── index.md            # Master status — read every session (~50-80 lines)
├── open-decisions.md   # Unresolved decisions needing input (~50-100 lines active)
├── phase-0.md          # One file per project phase
├── phase-1.md
└── ...
```

### Rules

1. **Read `docs/status/index.md` at the start of every session.** This tells you the current project state and which phase file to load.
2. **Load the phase file for the phase you are working in.** This tells you what's done, what's remaining, and what decisions/deviations exist.
3. **Check `docs/status/open-decisions.md` before starting a deliverable.** If your work depends on an unresolved decision, do not guess — flag it and request user guidance.
4. **Update the phase file after completing any deliverable.** Mark the checkbox `[x]` and optionally note the key file path.
5. **Log decisions when making non-trivial implementation choices.** Include: context (what prompted it), decision (what was chosen), rationale (why, 2-3 lines).
6. **Log deviations when implementation differs from the spec.** Include: spec reference, what changed, rationale.
7. **Add open decisions when encountering unresolved questions.** Include: affected phases, blocked deliverables, options with trade-offs.
8. **Keep entries concise.** 3-5 lines per decision/deviation. Link to code or spec references rather than duplicating content.

### ID Conventions

- **Decision IDs**: `D-{phase}.{sequence}` (e.g., `D-1.03` = 3rd decision in Phase 1)
- **Deviation IDs**: `V-{phase}.{sequence}` (e.g., `V-2.01` = 1st deviation in Phase 2)
- **Cross-phase decision IDs**: `X-{sequence}` (e.g., `X-03` = 3rd cross-phase decision)
- **Open decision IDs**: `OD-{sequence}` (e.g., `OD-03` = 3rd open decision)
- **Deliverable status**: `[x]` done, `[ ]` not started, `[-]` in progress, `[~]` descoped/deferred
- **Dates**: YYYY-MM-DD format on all entries

## Code Style & Conventions

### Universal Rules

- **Commits**: Conventional commit messages. Reference the relevant doc or module where applicable.
- **No dead code**: Do not comment out code. Delete it. Git preserves history.
- **No premature abstraction**: Three similar lines of code is better than a premature helper function. Abstract only when a pattern appears 3+ times.
- **No over-engineering**: Implement what is documented. Do not add features, configurability, or "improvements" beyond documented scope.
- **File length**: Target 300 lines, maximum 500. Split into modules when approaching the limit.

### Project-Specific Conventions (Required)

Every project must have a `docs/conventions.md` file documenting its language and framework conventions. If this file does not exist when an agent begins work, the agent must create it before writing any implementation code. At minimum, it must cover:

- **Language and runtime** — Version, type system requirements (e.g., strict mode, type hints on all signatures).
- **Async patterns** — When to use async/await vs synchronous code.
- **Naming conventions** — Per-language rules for functions, variables, classes, constants, files.
- **Import ordering** — Standard library → third-party → local, or whatever the project convention is.
- **Framework patterns** — Server vs client components, state management approach, routing conventions.
- **Styling** — CSS approach (Tailwind, CSS modules, styled-components, etc.) and any design system rules.
- **Testing tools** — Which test runner, assertion library, and mocking approach per language/layer.
- **Dependency management** — Package manager, lockfile conventions, version pinning strategy.

### Project Documentation Suite (Required)

Every project must maintain the following files in `docs/`. If any file does not exist when an agent begins work, the agent must create it before writing implementation code.

| File | Purpose |
| --- | --- |
| `docs/conventions.md` | Language and framework coding conventions (see checklist above) |
| `docs/tech-stack.md` | Layer-to-technology mapping with versions |
| `docs/architecture.md` | Service boundaries, data flow, environment variables |
| `docs/schema.md` | Database schema domains, key tables, relationships |
| `docs/glossary.md` | Project-specific terminology and domain concepts |
| `docs/directory.md` | Project structure map — what lives where, entry points, key paths |

#### `docs/tech-stack.md`

Table mapping each layer to its technology and version. At minimum:

- Frontend framework and version
- Backend framework and version
- Database engine and version
- Infrastructure / hosting
- CI/CD tooling
- Key libraries and their roles

#### `docs/architecture.md`

How the system fits together. At minimum:

- Service boundaries — which processes exist and how they communicate.
- Data flow — how data moves from external sources through the system to the user.
- Environment variables — list of required env vars with descriptions, which are public vs secret, and which services use them.

#### `docs/schema.md`

Database structure and conventions. At minimum:

- Schema domains — table mapping each domain to its key tables and purpose.
- Key relationships — foreign keys, join patterns, ownership chains.
- Security model — RLS policies, permission patterns, role definitions.
- Migration conventions — naming format, process for schema changes.

#### `docs/glossary.md`

Project-specific terminology that agents need to understand. At minimum:

- Domain concepts — business terms, acronyms, and their definitions.
- Platform concepts — internal abstractions, pipeline stages, scoring models, or system-specific terminology.
- Update this file whenever new domain terminology is introduced.

#### `docs/directory.md`

Project structure map for agent orientation. At minimum:

- Top-level directory listing with one-line descriptions of each folder's purpose.
- Key entry points — main application, API root, database configuration, test suites.
- Which directories have their own `CLAUDE.md` files.
- Update this file whenever directories are added, removed, or reorganised.

## Error Handling

### Principles

- **Fail fast at system boundaries.** Validate incoming data (web content, API responses, user messages) at ingestion. Reject malformed inputs with clear error classification.
- **Degrade gracefully internally.** If one source or method is unavailable, produce partial output with the others. Surface which sources were skipped and why.
- **Retry transiently, dead-letter permanently.** External API failures get exponential backoff retries. Parsing failures go to error logs for manual review. Never silently drop data.
- **Log context, not just errors.** When a job fails, log: source, job type, input summary, processing stage, and specific error.

### Anti-patterns to Avoid

- Do not catch-and-swallow exceptions. Every error must be logged and classified.
- Do not return default/empty values for missing data. Use null with explicit "data not available" indicators.
- Do not retry indefinitely. Set maximum retry counts and escalate.
- Do not trust external data without validation. Even structured APIs return unexpected formats.

## Security & Secrets

- **Never commit API keys, credentials, or tokens.** Use environment variables. Add `.env` to `.gitignore`.
- **Never log PII or sensitive content to stdout.** Structured logging must exclude personal data, financial details, and conversation content.
- **Never expose internal configuration or prompt templates in user-facing error messages.**
- **Sanitise all inbound user input.** Treat all external input as untrusted — form submissions, API payloads, messaging platform messages, filter expressions.
- **Encrypt sensitive data at rest and in transit.** HTTPS only. No plaintext credentials in config files.
- **Service role keys are server-only.** Never expose elevated-privilege credentials in client code, sync agents, or version control.

## Data Integrity

### Provenance

- **Every data point must be traceable to source.** All records include: source identifier and ingestion timestamp.
- **Every computed value must log its inputs.** Outputs must reference the specific data versions used to generate them.

### Auditability

- Configuration changes are versioned. Historical configs are preserved — never overwritten.
- Status transitions (draft → approved → delivered, or equivalent) are tracked with timestamps.

### Validation

- Cross-validate data across sources where possible.
- Flag low-confidence data rather than presenting it as authoritative.
- Data quality scores are surfaced to users, not hidden.
