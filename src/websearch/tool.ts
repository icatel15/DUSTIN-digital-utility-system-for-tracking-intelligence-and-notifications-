import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

type WebSearchDeps = {
	dailyLimit: number;
};

// In-memory daily counter. Resets on restart and when the date changes.
// Tavily's own rate limits (100 RPM free tier, 1000/month) are the real enforcement.
// This is a soft safety net to catch agent search loops.
let queriesUsedToday = 0;
let lastResetDate = new Date().toDateString();

function checkDailyLimit(limit: number): { allowed: boolean; remaining: number } {
	const today = new Date().toDateString();
	if (today !== lastResetDate) {
		queriesUsedToday = 0;
		lastResetDate = today;
	}
	return { allowed: queriesUsedToday < limit, remaining: Math.max(0, limit - queriesUsedToday) };
}

function ok(data: Record<string, unknown>): { content: Array<{ type: "text"; text: string }> } {
	return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function err(message: string): { content: Array<{ type: "text"; text: string }>; isError: true } {
	return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }], isError: true };
}

export function createWebSearchToolServer(deps: WebSearchDeps): McpSdkServerConfigWithInstance {
	const searchTool = tool(
		"phantom_web_search",
		`Search the web for current information using Tavily Search. Use this tool to find up-to-date news, facts, documentation, and real-time information that is beyond your training data. Results include titles, URLs, content snippets, relevance scores, and publication dates when available.

For news briefings, use topic: "news" and time_range: "day" to get today's stories.

Rate limit: ${deps.dailyLimit} searches per day.`,
		{
			query: z.string().min(1).max(400).describe("Search query"),
			topic: z
				.enum(["general", "news", "finance"])
				.default("general")
				.describe("Search topic: general web search, news articles, or financial data"),
			max_results: z.number().int().min(1).max(20).default(10).describe("Number of results to return (max 20)"),
			time_range: z
				.enum(["day", "week", "month", "year", "none"])
				.default("none")
				.describe("Freshness filter: day=past 24h, week=past week, month=past month, year=past year, none=no filter"),
			include_answer: z
				.boolean()
				.default(false)
				.describe("Include an AI-generated summary answer alongside results"),
		},
		async (input) => {
			try {
				const rateCheck = checkDailyLimit(deps.dailyLimit);
				if (!rateCheck.allowed) {
					return err(`Daily search limit reached (${deps.dailyLimit}). Resets at midnight.`);
				}

				const apiKey = process.env.TAVILY_API_KEY;
				if (!apiKey) {
					return err("Web search not configured. TAVILY_API_KEY is not set.");
				}

				const body: Record<string, unknown> = {
					query: input.query,
					topic: input.topic,
					max_results: input.max_results,
					include_answer: input.include_answer,
				};
				if (input.time_range !== "none") {
					body.time_range = input.time_range;
				}

				const response = await fetch("https://api.tavily.com/search", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${apiKey}`,
					},
					body: JSON.stringify(body),
				});

				if (!response.ok) {
					const errorText = await response.text();
					return err(`Tavily API error (${response.status}): ${errorText}`);
				}

				const data = (await response.json()) as {
					results?: Array<{
						title?: string;
						url?: string;
						content?: string;
						score?: number;
						published_date?: string;
					}>;
					answer?: string;
					response_time?: number;
					query?: string;
				};

				queriesUsedToday++;

				const results = (data.results ?? []).map((r) => ({
					title: r.title,
					url: r.url,
					content: r.content,
					score: r.score,
					published_date: r.published_date,
				}));

				return ok({
					query: input.query,
					topic: input.topic,
					results,
					totalResults: results.length,
					...(data.answer ? { answer: data.answer } : {}),
					responseTime: data.response_time,
					remaining: deps.dailyLimit - queriesUsedToday,
				});
			} catch (error: unknown) {
				const msg = error instanceof Error ? error.message : String(error);
				return err(msg);
			}
		},
	);

	return createSdkMcpServer({
		name: "phantom-web-search",
		tools: [searchTool],
	});
}
