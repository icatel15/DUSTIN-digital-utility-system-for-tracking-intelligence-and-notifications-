import type { PhantomConfig } from "../config/types.ts";
import { type ConfigUpdates, updateConfig } from "../config/writer.ts";
import { isValidSession } from "../ui/session.ts";
import { scheduleRestart } from "./restart.ts";

const AVAILABLE_MODELS = [
	{ id: "claude-haiku-4-5", name: "Claude Haiku 4.5", tier: "fast" },
	{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", tier: "balanced" },
	{ id: "claude-opus-4-6", name: "Claude Opus 4.6", tier: "capable" },
];

export type AdminHealthProvider = () => Promise<Record<string, unknown>>;

let adminConfig: PhantomConfig | null = null;
let adminHealthProvider: AdminHealthProvider | null = null;

export function setAdminConfig(config: PhantomConfig): void {
	adminConfig = config;
}

export function setAdminHealthProvider(provider: AdminHealthProvider): void {
	adminHealthProvider = provider;
}

function getSessionCookie(req: Request): string | null {
	const cookies = req.headers.get("Cookie") ?? "";
	const match = cookies.match(/(?:^|;\s*)phantom_session=([^;]*)/);
	return match ? decodeURIComponent(match[1]) : null;
}

function isAuthenticated(req: Request): boolean {
	const token = getSessionCookie(req);
	return token !== null && isValidSession(token);
}

export async function handleAdminRequest(req: Request): Promise<Response | null> {
	const url = new URL(req.url);

	if (!url.pathname.startsWith("/api/admin/")) return null;

	if (!isAuthenticated(req)) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	if (!adminConfig) {
		return Response.json({ error: "Not configured" }, { status: 500 });
	}

	const path = url.pathname.slice("/api/admin/".length);

	if (path === "config" && req.method === "GET") {
		return Response.json({
			name: adminConfig.name,
			model: adminConfig.model,
			effort: adminConfig.effort,
			role: adminConfig.role,
			port: adminConfig.port,
			domain: adminConfig.domain ?? null,
		});
	}

	if (path === "config" && req.method === "PATCH") {
		return handleConfigUpdate(req);
	}

	if (path === "models" && req.method === "GET") {
		return Response.json({ models: AVAILABLE_MODELS });
	}

	if (path === "restart" && req.method === "POST") {
		scheduleRestart();
		return Response.json({
			status: "restarting",
			message: "Container will restart in 2 seconds",
		});
	}

	if (path === "health" && req.method === "GET") {
		const health = adminHealthProvider ? await adminHealthProvider() : {};
		return Response.json({
			...health,
			config: {
				name: adminConfig.name,
				model: adminConfig.model,
				effort: adminConfig.effort,
				role: adminConfig.role,
			},
		});
	}

	return Response.json({ error: "Not found" }, { status: 404 });
}

async function handleConfigUpdate(req: Request): Promise<Response> {
	let body: Record<string, unknown>;
	try {
		body = (await req.json()) as Record<string, unknown>;
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const updates: ConfigUpdates = {};
	if (typeof body.model === "string" && body.model) {
		updates.model = body.model;
	}
	if (typeof body.effort === "string" && ["low", "medium", "high", "max"].includes(body.effort)) {
		updates.effort = body.effort as ConfigUpdates["effort"];
	}

	if (Object.keys(updates).length === 0) {
		return Response.json({ error: "No valid updates provided" }, { status: 400 });
	}

	try {
		updateConfig(updates);
		return Response.json({
			updated: updates,
			message: "Config updated. Restart required for changes to take effect.",
			restartRequired: true,
		});
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return Response.json({ error: msg }, { status: 400 });
	}
}
