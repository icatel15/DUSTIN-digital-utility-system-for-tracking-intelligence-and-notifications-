# Glossary

Project-specific terminology for DUSTIN.

## Project Terms

- **DUSTIN**: Digital Utility System for Tracking, Intelligence & Notifications. The personal AI assistant this project builds.
- **Phantom**: The upstream agent framework (v0.18.1) that DUSTIN is forked from. Provides the runtime, evolution engine, memory system, and channel abstractions.

## Memory System

- **Episodic memory**: Session transcripts stored as vector embeddings in Qdrant. Enables "what did we talk about last week?" queries.
- **Semantic memory**: Accumulated facts extracted from conversations, with contradiction detection. Represents what the agent "knows" about users and their world.
- **Procedural memory**: Learned workflows and step-by-step procedures the agent can recall and execute.

## Evolution System

- **Evolution**: The 6-step self-improvement pipeline that runs after each session: extract observations, consolidate patterns, propose changes, validate via 5-Gate, apply, and verify.
- **Constitution**: Immutable principles that the evolution engine cannot modify. Safety guardrails that persist across all evolution cycles.
- **5-Gate Validation**: Five checks every proposed evolution change must pass: Constitution compliance, regression testing, size limits, drift detection, and safety review.
- **Observation**: A correction, preference, or fact extracted from a session by the evolution engine. Raw material for consolidation.
- **Consolidation**: Periodic compression of accumulated observations into higher-level principles or configuration changes.

## Configuration & Roles

- **Phantom-config**: Directory of evolved configuration files (persona, domain knowledge, strategies). Grows over time as the evolution engine learns.
- **Role**: YAML-defined specialization that controls system prompt assembly, available tools, and evolution focus areas.

## Infrastructure

- **MCP**: Model Context Protocol. The standard interface for external clients (Claude Desktop, other agents) to connect to DUSTIN and invoke its tools.
- **Channel**: Communication adapter (Telegram, Email, Webhook) implementing a standard interface for receiving and sending messages.
- **Dynamic tools**: Tools the agent creates and registers at runtime, stored in the `tools` table and loaded on startup.

## User Model

- **Owner**: Primary user (you). Mapped via `OWNER_TELEGRAM_USER_ID` environment variable. Has full access to all commands and configuration.
- **Partner**: Secondary user (your wife). Mapped via `PARTNER_TELEGRAM_USER_ID` environment variable. Has access to shared features but not admin operations.
- **Chat context**: Classification of where a message originated: `group` (shared group chat), `dm_owner` (direct message from owner), or `dm_partner` (direct message from partner). Used by evolution to scope observations.
