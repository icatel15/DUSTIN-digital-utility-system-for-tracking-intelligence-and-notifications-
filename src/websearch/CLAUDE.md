# src/websearch/ -- Web search via Tavily API

MCP tool server providing web search capability to the agent. Conditional on `TAVILY_API_KEY` env var.

Universal rules are governed by the root `CLAUDE.md`.

## File Inventory

| File | Purpose |
| --- | --- |
| `tool.ts` | `createWebSearchToolServer()` — MCP tool server wrapping Tavily Search API. Tool: `phantom_web_search`. |
| `__tests__/tool.test.ts` | Unit tests for server config creation. |

## API

- **Endpoint**: `POST https://api.tavily.com/search`
- **Auth**: `Authorization: Bearer $TAVILY_API_KEY`
- **Topics**: `general`, `news`, `finance`
- **Freshness**: `day`, `week`, `month`, `year`, or no filter
- **Free tier**: 1000 queries/month, 100 RPM

## Rate Limiting

In-memory daily counter (same pattern as `src/email/tool.ts`). Default 50/day, configurable via `TAVILY_DAILY_LIMIT` env var. Resets on date change or container restart.

## Dependencies

- `@anthropic-ai/claude-agent-sdk` — `createSdkMcpServer`, `tool`
- `zod` — input validation
- Bun built-in `fetch` — HTTP requests (no external HTTP library)

## Update Protocol

Update this file when changing the search API provider, adding tools, or modifying rate limiting.
