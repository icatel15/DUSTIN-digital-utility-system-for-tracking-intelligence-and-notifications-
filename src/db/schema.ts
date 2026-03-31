/**
 * Database schema reference.
 *
 * Tables are created via SQL migration files in supabase/migrations/.
 * This file exists as a reference for the expected table structure.
 * It is NOT used at runtime — migrations are applied via Supabase CLI.
 *
 * Core tables (from Phantom):
 * - sessions: Agent conversation sessions
 * - cost_events: Token usage and cost tracking
 * - onboarding_state: Onboarding flow state
 * - dynamic_tools: User-created MCP tools
 * - scheduled_jobs: Cron job definitions
 * - secrets: Encrypted credential storage
 * - secret_requests: Credential access requests
 * - tasks: MCP task queue
 * - mcp_audit: MCP interaction audit log
 *
 * DUSTIN-specific tables:
 * - users: Telegram user identity mapping
 * - config_versions: Evolution version history
 * - notion_sync_state: Notion bidirectional sync tracking
 * - audit_log: Application-level audit trail
 * - evolution_observations: Raw observations from sessions
 *
 * See supabase/migrations/ for the full DDL.
 */
export const SCHEMA_VERSION = "1.0.0";
