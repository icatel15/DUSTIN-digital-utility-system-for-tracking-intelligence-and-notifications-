import { createHash, timingSafeEqual } from "node:crypto";
import type { AgentRuntime } from "../agent/runtime.ts";
import type { SlackChannel } from "../channels/slack.ts";
import type { PhantomConfig } from "../config/types.ts";
import type { AuditLogger } from "../mcp/audit.ts";
import type { RateLimiter } from "../mcp/rate-limiter.ts";
import type { PhantomMcpServer } from "../mcp/server.ts";
import type { MemoryHealth } from "../memory/types.ts";
import { handleUiRequest } from "../ui/serve.ts";

const VERSION = "0.18.1";

type MemoryHealthProvider = () => Promise<MemoryHealth>;
type EvolutionVersionProvider = () => number;
type McpServerProvider = () => PhantomMcpServer | null;
type ChannelHealthProvider = () => Record<string, boolean>;
type RoleInfoProvider = () => { id: string; name: string } | null;
type OnboardingStatusProvider = () => string | Promise<string>;
type WebhookHandler = (req: Request) => Promise<Response>;
type PeerHealthProvider = () => Record<string, { healthy: boolean; latencyMs: number; error?: string }>;
export type TriggerDeps = {
	runtime: AgentRuntime;
	slackChannel?: SlackChannel;
	ownerUserId?: string;
	audit?: AuditLogger;
	rateLimiter?: RateLimiter;
	deliveryAllowlist?: Set<string>;
};

let memoryHealthProvider: MemoryHealthProvider | null = null;
let evolutionVersionProvider: EvolutionVersionProvider | null = null;
let mcpServerProvider: McpServerProvider | null = null;
let channelHealthProvider: ChannelHealthProvider | null = null;
let roleInfoProvider: RoleInfoProvider | null = null;
let onboardingStatusProvider: OnboardingStatusProvider | null = null;
let webhookHandler: WebhookHandler | null = null;
let peerHealthProvider: PeerHealthProvider | null = null;
let triggerDeps: TriggerDeps | null = null;

export function setMemoryHealthProvider(provider: MemoryHealthProvider): void {
	memoryHealthProvider = provider;
}

export function setEvolutionVersionProvider(provider: EvolutionVersionProvider): void {
	evolutionVersionProvider = provider;
}

export function setMcpServerProvider(provider: McpServerProvider): void {
	mcpServerProvider = provider;
}

export function setChannelHealthProvider(provider: ChannelHealthProvider): void {
	channelHealthProvider = provider;
}

export function setRoleInfoProvider(provider: RoleInfoProvider): void {
	roleInfoProvider = provider;
}

export function setOnboardingStatusProvider(provider: OnboardingStatusProvider): void {
	onboardingStatusProvider = provider;
}

export function setWebhookHandler(handler: WebhookHandler): void {
	webhookHandler = handler;
}

export function setPeerHealthProvider(provider: PeerHealthProvider): void {
	peerHealthProvider = provider;
}

export function setTriggerDeps(deps: TriggerDeps): void {
	triggerDeps = deps;
}

export function startServer(config: PhantomConfig, startedAt: number): ReturnType<typeof Bun.serve> {
	const server = Bun.serve({
		port: config.port,
		async fetch(req) {
			const url = new URL(req.url);

			if (url.pathname === "/health") {
				const memory: MemoryHealth = memoryHealthProvider
					? await memoryHealthProvider()
					: { qdrant: false, embeddings: false, configured: false };

				const channels: Record<string, boolean> = channelHealthProvider ? channelHealthProvider() : {};

				const allHealthy = memory.qdrant && memory.embeddings;
				const someHealthy = memory.qdrant || memory.embeddings;
				// Both up -> ok. One up -> degraded. Both down + configured -> down. Not configured -> ok.
				const status = allHealthy ? "ok" : someHealthy ? "degraded" : memory.configured ? "down" : "ok";
				const evolutionGeneration = evolutionVersionProvider ? evolutionVersionProvider() : 0;

				const roleInfo = roleInfoProvider ? roleInfoProvider() : null;

				const onboardingStatus = onboardingStatusProvider ? await onboardingStatusProvider() : null;
				const peers = peerHealthProvider ? peerHealthProvider() : null;

				return Response.json({
					status,
					uptime: Math.floor((Date.now() - startedAt) / 1000),
					version: VERSION,
					agent: config.name,
					role: roleInfo ?? { id: config.role, name: config.role },
					channels,
					memory,
					evolution: {
						generation: evolutionGeneration,
					},
					...(onboardingStatus ? { onboarding: onboardingStatus } : {}),
					...(peers && Object.keys(peers).length > 0 ? { peers } : {}),
				});
			}

			if (url.pathname === "/mcp") {
				const mcpServer = mcpServerProvider?.();
				if (!mcpServer) {
					return Response.json(
						{ jsonrpc: "2.0", error: { code: -32603, message: "MCP server not initialized" }, id: null },
						{ status: 503 },
					);
				}
				return mcpServer.handleRequest(req);
			}

			if (url.pathname === "/trigger" && req.method === "POST") {
				return handleTrigger(req);
			}

			if (url.pathname === "/webhook") {
				if (!webhookHandler) {
					return Response.json({ status: "error", message: "Webhook channel not configured" }, { status: 503 });
				}
				return webhookHandler(req);
			}

			if (url.pathname.startsWith("/ui")) {
				return handleUiRequest(req);
			}

			return Response.json({ error: "Not found" }, { status: 404 });
		},
	});

	console.log(`[phantom] HTTP server listening on port ${config.port}`);
	return server;
}

function verifyTriggerAuth(req: Request): boolean {
	const triggerSecret = process.env.TRIGGER_SECRET;
	if (!triggerSecret) return false;

	const authHeader = req.headers.get("Authorization");
	if (!authHeader?.startsWith("Bearer ")) return false;

	const token = authHeader.slice(7).trim();
	if (!token) return false;

	try {
		const expected = Buffer.from(triggerSecret);
		const actual = Buffer.from(token);
		if (expected.length !== actual.length) return false;
		return timingSafeEqual(expected, actual);
	} catch {
		return false;
	}
}

function hashTaskForAudit(task: string): string {
	return createHash("sha256").update(task).digest("hex").slice(0, 16);
}

async function handleTrigger(req: Request): Promise<Response> {
	const triggerSecret = process.env.TRIGGER_SECRET;

	// Feature disabled when TRIGGER_SECRET is unset — return 404 to avoid revealing the endpoint
	if (!triggerSecret) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}

	if (!triggerDeps) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}

	// Authenticate
	if (!verifyTriggerAuth(req)) {
		// Log rejected auth attempt without parsing body
		if (triggerDeps.audit) {
			await triggerDeps.audit.log({
				client_name: "trigger:unauthenticated",
				method: "POST /trigger",
				tool_name: null,
				resource_uri: null,
				input_summary: null,
				output_summary: "Authentication failed",
				cost_usd: 0,
				duration_ms: 0,
				status: "error",
			});
		}
		return Response.json({ status: "error", message: "Unauthorized" }, { status: 401 });
	}

	// Rate limit
	if (triggerDeps.rateLimiter) {
		const rateResult = triggerDeps.rateLimiter.check("trigger");
		if (!rateResult.allowed) {
			if (triggerDeps.audit) {
				await triggerDeps.audit.log({
					client_name: "trigger",
					method: "POST /trigger",
					tool_name: null,
					resource_uri: null,
					input_summary: null,
					output_summary: "Rate limited",
					cost_usd: 0,
					duration_ms: 0,
					status: "error",
				});
			}
			return Response.json(
				{ status: "error", message: "Rate limit exceeded" },
				{ status: 429, headers: { "Retry-After": String(rateResult.retryAfter) } },
			);
		}
	}

	let body: { task?: string; delivery?: { channel?: string; target?: string }; source?: string };
	try {
		body = (await req.json()) as typeof body;
	} catch {
		return Response.json({ status: "error", message: "Invalid JSON body" }, { status: 400 });
	}

	if (!body.task || typeof body.task !== "string") {
		return Response.json({ status: "error", message: "Missing required field: task" }, { status: 400 });
	}

	const conversationId = `trigger:${Date.now()}`;
	const source = body.source ?? "http";
	const deliveryTarget = body.delivery?.target ?? "owner";

	// Enforce delivery target allowlist (owner is always permitted)
	if (
		deliveryTarget !== "owner" &&
		triggerDeps.deliveryAllowlist &&
		!triggerDeps.deliveryAllowlist.has(deliveryTarget)
	) {
		if (triggerDeps.audit) {
			await triggerDeps.audit.log({
				client_name: "trigger",
				method: "POST /trigger",
				tool_name: null,
				resource_uri: null,
				input_summary: `target=${deliveryTarget} REJECTED (not in allowlist)`,
				output_summary: "Delivery target not allowed",
				cost_usd: 0,
				duration_ms: 0,
				status: "error",
			});
		}
		return Response.json({ status: "error", message: "Delivery target not in allowlist" }, { status: 403 });
	}

	try {
		const response = await triggerDeps.runtime.handleMessage("trigger", conversationId, body.task);

		// Deliver via Slack if requested
		const deliveryChannel = body.delivery?.channel ?? "slack";

		if (deliveryChannel === "slack" && triggerDeps.slackChannel) {
			if (deliveryTarget === "owner" && triggerDeps.ownerUserId) {
				await triggerDeps.slackChannel.sendDm(triggerDeps.ownerUserId, response.text);
			} else if (deliveryTarget.startsWith("C")) {
				await triggerDeps.slackChannel.postToChannel(deliveryTarget, response.text);
			} else if (deliveryTarget.startsWith("U")) {
				await triggerDeps.slackChannel.sendDm(deliveryTarget, response.text);
			}
		}

		// Audit log: metadata only, no raw task text
		if (triggerDeps.audit) {
			await triggerDeps.audit.log({
				client_name: "trigger",
				method: "POST /trigger",
				tool_name: null,
				resource_uri: null,
				input_summary: `source=${source} target=${deliveryTarget} len=${body.task.length} hash=${hashTaskForAudit(body.task)}`,
				output_summary: `conversationId=${conversationId}`,
				cost_usd: response.cost.totalUsd,
				duration_ms: response.durationMs,
				status: "success",
			});
		}

		return Response.json({
			status: "ok",
			source,
			conversationId,
			response: response.text,
			cost: response.cost.totalUsd,
			durationMs: response.durationMs,
		});
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return Response.json({ status: "error", message: msg }, { status: 500 });
	}
}
