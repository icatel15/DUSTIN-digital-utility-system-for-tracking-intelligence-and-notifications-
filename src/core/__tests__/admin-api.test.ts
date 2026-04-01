import { beforeEach, describe, expect, test } from "bun:test";
import { createSession } from "../../ui/session.ts";
import { handleAdminRequest, setAdminConfig, setAdminHealthProvider } from "../admin-api.ts";

const BASE_CONFIG = {
	name: "test-phantom",
	port: 3100,
	role: "swe",
	model: "claude-haiku-4-5",
	effort: "max" as const,
	max_budget_usd: 0,
	timeout_minutes: 240,
};

function authedRequest(path: string, options: RequestInit = {}): Request {
	const { sessionToken } = createSession();
	return new Request(`http://localhost:3100${path}`, {
		...options,
		headers: {
			...(options.headers ?? {}),
			Cookie: `phantom_session=${sessionToken}`,
		},
	});
}

function unauthRequest(path: string, options: RequestInit = {}): Request {
	return new Request(`http://localhost:3100${path}`, options);
}

describe("admin API", () => {
	beforeEach(() => {
		setAdminConfig({ ...BASE_CONFIG });
	});

	describe("auth", () => {
		test("rejects unauthenticated requests with 401", async () => {
			const res = await handleAdminRequest(unauthRequest("/api/admin/config"));
			expect(res).not.toBeNull();
			expect(res!.status).toBe(401);
		});

		test("rejects requests with invalid session cookie", async () => {
			const req = new Request("http://localhost:3100/api/admin/config", {
				headers: { Cookie: "phantom_session=invalid-token" },
			});
			const res = await handleAdminRequest(req);
			expect(res!.status).toBe(401);
		});

		test("accepts requests with valid session cookie", async () => {
			const res = await handleAdminRequest(authedRequest("/api/admin/config"));
			expect(res).not.toBeNull();
			expect(res!.status).toBe(200);
		});
	});

	describe("routing", () => {
		test("returns null for non-admin routes", async () => {
			const res = await handleAdminRequest(authedRequest("/health"));
			expect(res).toBeNull();
		});

		test("returns 404 for unknown admin routes", async () => {
			const res = await handleAdminRequest(authedRequest("/api/admin/nonexistent"));
			expect(res!.status).toBe(404);
		});
	});

	describe("GET /api/admin/config", () => {
		test("returns current config", async () => {
			const res = await handleAdminRequest(authedRequest("/api/admin/config"));
			const body = await res!.json();
			expect(body.name).toBe("test-phantom");
			expect(body.model).toBe("claude-haiku-4-5");
			expect(body.effort).toBe("max");
			expect(body.role).toBe("swe");
			expect(body.port).toBe(3100);
			expect(body.domain).toBeNull();
		});
	});

	describe("GET /api/admin/models", () => {
		test("returns available models", async () => {
			const res = await handleAdminRequest(authedRequest("/api/admin/models"));
			const body = await res!.json();
			expect(body.models).toHaveLength(3);
			expect(body.models[0].id).toBe("claude-haiku-4-5");
			expect(body.models[1].id).toBe("claude-sonnet-4-6");
			expect(body.models[2].id).toBe("claude-opus-4-6");
		});
	});

	describe("PATCH /api/admin/config", () => {
		test("rejects empty updates", async () => {
			const res = await handleAdminRequest(
				authedRequest("/api/admin/config", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({}),
				}),
			);
			expect(res!.status).toBe(400);
		});

		test("rejects invalid JSON", async () => {
			const res = await handleAdminRequest(
				authedRequest("/api/admin/config", {
					method: "PATCH",
					body: "not json",
				}),
			);
			expect(res!.status).toBe(400);
		});

		test("rejects invalid effort value", async () => {
			const res = await handleAdminRequest(
				authedRequest("/api/admin/config", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ effort: "turbo" }),
				}),
			);
			expect(res!.status).toBe(400);
		});
	});

	describe("POST /api/admin/restart", () => {
		test("returns restarting status", async () => {
			// Mock process.kill to prevent actual restart
			const originalKill = process.kill;
			process.kill = (() => true) as typeof process.kill;

			try {
				const res = await handleAdminRequest(authedRequest("/api/admin/restart", { method: "POST" }));
				const body = await res!.json();
				expect(body.status).toBe("restarting");
				expect(body.message).toContain("restart");
			} finally {
				process.kill = originalKill;
			}
		});
	});

	describe("GET /api/admin/health", () => {
		test("returns health with config details", async () => {
			setAdminHealthProvider(async () => ({
				status: "ok",
				uptime: 100,
			}));

			const res = await handleAdminRequest(authedRequest("/api/admin/health"));
			const body = await res!.json();
			expect(body.status).toBe("ok");
			expect(body.uptime).toBe(100);
			expect(body.config.name).toBe("test-phantom");
			expect(body.config.model).toBe("claude-haiku-4-5");
		});

		test("returns config even without health provider", async () => {
			setAdminHealthProvider(null as unknown as () => Promise<Record<string, unknown>>);
			const res = await handleAdminRequest(authedRequest("/api/admin/health"));
			const body = await res!.json();
			expect(body.config.name).toBe("test-phantom");
		});
	});
});
