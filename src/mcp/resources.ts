import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import type { PhantomConfig } from "../config/types.ts";
import type { SupabaseClient } from "../db/connection.ts";
import type { EvolutionEngine } from "../evolution/engine.ts";
import type { MemorySystem } from "../memory/system.ts";

export type ResourceDependencies = {
	config: PhantomConfig;
	db: SupabaseClient;
	startedAt: number;
	memory: MemorySystem | null;
	evolution: EvolutionEngine | null;
};

export function registerResources(server: McpServer, deps: ResourceDependencies): void {
	registerHealthResource(server, deps);
	registerIdentityResource(server, deps);
	registerConfigCurrentResource(server, deps);
	registerConfigChangelogResource(server, deps);
	registerTasksActiveResource(server, deps);
	registerTasksCompletedResource(server, deps);
	registerMetricsSummaryResource(server, deps);
	registerMetricsCostResource(server, deps);
	registerMemoryRecentResource(server, deps);
	registerMemoryDomainResource(server, deps);
}

function registerHealthResource(server: McpServer, deps: ResourceDependencies): void {
	server.registerResource(
		"health",
		"phantom://health",
		{
			description: "System health status and service availability",
			mimeType: "application/json",
		},
		async (): Promise<ReadResourceResult> => {
			const memoryHealth = deps.memory
				? await deps.memory.healthCheck().catch(() => ({ qdrant: false, embeddings: false }))
				: { qdrant: false, embeddings: false };

			const uptimeSeconds = Math.floor((Date.now() - deps.startedAt) / 1000);
			const allHealthy = memoryHealth.qdrant && memoryHealth.embeddings;

			return {
				contents: [
					{
						uri: "phantom://health",
						text: JSON.stringify(
							{
								status: allHealthy ? "ok" : "degraded",
								uptime: uptimeSeconds,
								version: "0.4.0",
								agent: deps.config.name,
								memory: memoryHealth,
								evolution: {
									generation: deps.evolution?.getCurrentVersion() ?? 0,
								},
							},
							null,
							2,
						),
					},
				],
			};
		},
	);
}

function registerIdentityResource(server: McpServer, deps: ResourceDependencies): void {
	server.registerResource(
		"identity",
		"phantom://identity",
		{
			description: "The Phantom's role, name, and capability description",
			mimeType: "application/json",
		},
		async (): Promise<ReadResourceResult> => {
			const persona = deps.evolution?.getConfig().persona ?? "";
			return {
				contents: [
					{
						uri: "phantom://identity",
						text: JSON.stringify(
							{
								name: deps.config.name,
								role: deps.config.role,
								model: deps.config.model,
								persona: persona.slice(0, 1000),
								capabilities: [
									"phantom_ask",
									"phantom_status",
									"phantom_memory_query",
									"phantom_task_create",
									"phantom_task_status",
									"phantom_config",
									"phantom_history",
									"phantom_metrics",
								],
							},
							null,
							2,
						),
					},
				],
			};
		},
	);
}

function registerConfigCurrentResource(server: McpServer, deps: ResourceDependencies): void {
	server.registerResource(
		"config-current",
		"phantom://config/current",
		{
			description: "The Phantom's current evolved configuration in full",
			mimeType: "application/json",
		},
		async (): Promise<ReadResourceResult> => {
			if (!deps.evolution) {
				return {
					contents: [{ uri: "phantom://config/current", text: JSON.stringify({ error: "Evolution not available" }) }],
				};
			}

			const config = deps.evolution.getConfig();
			return {
				contents: [
					{
						uri: "phantom://config/current",
						text: JSON.stringify(config, null, 2),
					},
				],
			};
		},
	);
}

function registerConfigChangelogResource(server: McpServer, deps: ResourceDependencies): void {
	server.registerResource(
		"config-changelog",
		"phantom://config/changelog",
		{
			description: "History of configuration changes from the evolution engine",
			mimeType: "application/json",
		},
		async (): Promise<ReadResourceResult> => {
			if (!deps.evolution) {
				return { contents: [{ uri: "phantom://config/changelog", text: JSON.stringify({ versions: [] }) }] };
			}

			const history = deps.evolution.getVersionHistory(20);
			return {
				contents: [
					{
						uri: "phantom://config/changelog",
						text: JSON.stringify({ versions: history }, null, 2),
					},
				],
			};
		},
	);
}

function registerTasksActiveResource(server: McpServer, deps: ResourceDependencies): void {
	server.registerResource(
		"tasks-active",
		"phantom://tasks/active",
		{
			description: "Currently active and queued tasks",
			mimeType: "application/json",
		},
		async (): Promise<ReadResourceResult> => {
			const { data: tasks } = await deps.db
				.from("tasks")
				.select("*")
				.in("status", ["queued", "active"])
				.order("created_at", { ascending: false })
				.limit(50);

			return { contents: [{ uri: "phantom://tasks/active", text: JSON.stringify({ tasks: tasks ?? [] }, null, 2) }] };
		},
	);
}

function registerTasksCompletedResource(server: McpServer, deps: ResourceDependencies): void {
	server.registerResource(
		"tasks-completed",
		"phantom://tasks/completed",
		{
			description: "Recently completed tasks with results",
			mimeType: "application/json",
		},
		async (): Promise<ReadResourceResult> => {
			const { data: tasks } = await deps.db
				.from("tasks")
				.select("*")
				.in("status", ["completed", "failed"])
				.order("completed_at", { ascending: false })
				.limit(50);

			return {
				contents: [{ uri: "phantom://tasks/completed", text: JSON.stringify({ tasks: tasks ?? [] }, null, 2) }],
			};
		},
	);
}

function registerMetricsSummaryResource(server: McpServer, deps: ResourceDependencies): void {
	server.registerResource(
		"metrics-summary",
		"phantom://metrics/summary",
		{
			description: "Performance dashboard data including costs, sessions, and evolution stats",
			mimeType: "application/json",
		},
		async (): Promise<ReadResourceResult> => {
			const metrics = deps.evolution?.getMetrics();

			const { data: costData } = await deps.db
				.from("cost_events")
				.select("cost_usd")
				.gte("created_at", new Date(new Date().toISOString().slice(0, 10)).toISOString());

			const costToday = (costData ?? []).reduce((sum, row) => sum + (row.cost_usd ?? 0), 0);

			return {
				contents: [
					{
						uri: "phantom://metrics/summary",
						text: JSON.stringify(
							{
								sessions: metrics?.session_count ?? 0,
								successRate: metrics?.success_rate_7d ?? 0,
								costToday,
								evolutionGeneration: deps.evolution?.getCurrentVersion() ?? 0,
								evolutionCount: metrics?.evolution_count ?? 0,
							},
							null,
							2,
						),
					},
				],
			};
		},
	);
}

function registerMetricsCostResource(server: McpServer, deps: ResourceDependencies): void {
	server.registerResource(
		"metrics-cost",
		new ResourceTemplate("phantom://metrics/cost/{period}", {
			list: async () => ({
				resources: [
					{ uri: "phantom://metrics/cost/today", name: "Cost: Today" },
					{ uri: "phantom://metrics/cost/week", name: "Cost: This Week" },
					{ uri: "phantom://metrics/cost/month", name: "Cost: This Month" },
				],
			}),
		}),
		{
			description: "Cost breakdown by period",
			mimeType: "application/json",
		},
		async (uri, { period }): Promise<ReadResourceResult> => {
			const now = new Date();
			let dateFilter: string;
			if (period === "today") {
				dateFilter = now.toISOString().slice(0, 10);
			} else if (period === "week") {
				const d = new Date(now);
				d.setDate(d.getDate() - 7);
				dateFilter = d.toISOString();
			} else {
				// month
				const d = new Date(now);
				d.setDate(d.getDate() - 30);
				dateFilter = d.toISOString();
			}

			const { data: costData } = await deps.db.from("cost_events").select("cost_usd").gte("created_at", dateFilter);

			const rows = costData ?? [];
			const total = rows.reduce((sum, row) => sum + (row.cost_usd ?? 0), 0);

			return {
				contents: [
					{
						uri: uri.href,
						text: JSON.stringify({ period, totalCost: total, events: rows.length }, null, 2),
					},
				],
			};
		},
	);
}

function registerMemoryRecentResource(server: McpServer, deps: ResourceDependencies): void {
	server.registerResource(
		"memory-recent",
		"phantom://memory/recent",
		{
			description: "Recent episodic memories from the Phantom's experience",
			mimeType: "application/json",
		},
		async (): Promise<ReadResourceResult> => {
			if (!deps.memory || !deps.memory.isReady()) {
				return {
					contents: [{ uri: "phantom://memory/recent", text: JSON.stringify({ episodes: [], available: false }) }],
				};
			}

			const episodes = await deps.memory.recallEpisodes("recent activity", { limit: 10 }).catch(() => []);
			return {
				contents: [
					{
						uri: "phantom://memory/recent",
						text: JSON.stringify({ episodes, count: episodes.length }, null, 2),
					},
				],
			};
		},
	);
}

function registerMemoryDomainResource(server: McpServer, deps: ResourceDependencies): void {
	server.registerResource(
		"memory-domain",
		new ResourceTemplate("phantom://memory/domain/{topic}", {
			list: async () => ({
				resources: [
					{ uri: "phantom://memory/domain/codebase", name: "Memory: Codebase" },
					{ uri: "phantom://memory/domain/errors", name: "Memory: Errors" },
					{ uri: "phantom://memory/domain/processes", name: "Memory: Processes" },
				],
			}),
		}),
		{
			description: "Semantic memory filtered by topic",
			mimeType: "application/json",
		},
		async (uri, { topic }): Promise<ReadResourceResult> => {
			if (!deps.memory || !deps.memory.isReady()) {
				return { contents: [{ uri: uri.href, text: JSON.stringify({ facts: [], available: false }) }] };
			}

			const facts = await deps.memory.recallFacts(topic as string, { limit: 20 }).catch(() => []);
			return {
				contents: [
					{
						uri: uri.href,
						text: JSON.stringify({ topic, facts, count: facts.length }, null, 2),
					},
				],
			};
		},
	);
}
