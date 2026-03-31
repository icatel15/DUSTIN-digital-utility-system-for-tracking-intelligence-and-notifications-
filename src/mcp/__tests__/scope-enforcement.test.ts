import { beforeEach, describe, expect, test } from "bun:test";
import { AuthMiddleware, TOOL_SCOPES, getRequiredScope } from "../auth.ts";
import { hashTokenSync } from "../config.ts";
import { McpTransportManager } from "../transport.ts";
import type { AuthResult, McpConfig } from "../types.ts";

// ---------------------------------------------------------------------------
// Shared test tokens & config
// ---------------------------------------------------------------------------
const RAW_ADMIN_TOKEN = "scope-test-admin-token";
const RAW_OPERATOR_TOKEN = "scope-test-operator-token";
const RAW_READ_TOKEN = "scope-test-read-token";

function buildConfig(): McpConfig {
	return {
		tokens: [
			{ name: "admin-client", hash: hashTokenSync(RAW_ADMIN_TOKEN), scopes: ["read", "operator", "admin"] },
			{ name: "operator-client", hash: hashTokenSync(RAW_OPERATOR_TOKEN), scopes: ["read", "operator"] },
			{ name: "read-client", hash: hashTokenSync(RAW_READ_TOKEN), scopes: ["read"] },
		],
		rate_limit: { requests_per_minute: 60, burst: 10 },
	};
}

// Pre-built AuthResult values for transport-layer tests
const adminAuth: AuthResult = {
	authenticated: true,
	clientName: "admin-client",
	scopes: ["read", "operator", "admin"],
};
const operatorAuth: AuthResult = { authenticated: true, clientName: "operator-client", scopes: ["read", "operator"] };
const readAuth: AuthResult = { authenticated: true, clientName: "read-client", scopes: ["read"] };
const unauthenticated: AuthResult = { authenticated: false, error: "Missing Authorization header" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a POST Request with a JSON-RPC tools/call body */
function toolCallRequest(toolName: string, sessionId?: string): Request {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (sessionId) headers["mcp-session-id"] = sessionId;
	return new Request("http://localhost/mcp", {
		method: "POST",
		headers,
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name: toolName },
		}),
	});
}

/** The 17 built-in tools grouped by expected scope */
const READ_TOOLS = [
	"phantom_status",
	"phantom_memory_query",
	"phantom_task_status",
	"phantom_config",
	"phantom_history",
	"phantom_metrics",
	"phantom_list_dynamic_tools",
	"phantom_codebase_query",
	"phantom_pr_status",
	"phantom_ci_status",
	"phantom_deploy_status",
	"phantom_repo_info",
];

const OPERATOR_TOOLS = ["phantom_ask", "phantom_task_create", "phantom_review_request"];

const ADMIN_TOOLS = ["phantom_register_tool", "phantom_unregister_tool"];

// ==========================================================================
// 1. getRequiredScope — pure function tests
// ==========================================================================
describe("getRequiredScope", () => {
	test("returns 'admin' for unknown tool names (default deny)", () => {
		expect(getRequiredScope("totally_unknown_tool")).toBe("admin");
		expect(getRequiredScope("")).toBe("admin");
		expect(getRequiredScope("phantom_nonexistent")).toBe("admin");
	});

	test("returns correct scope for all 17 built-in tools", () => {
		// Verify we actually have 17 entries
		expect(Object.keys(TOOL_SCOPES)).toHaveLength(17);

		for (const tool of READ_TOOLS) {
			expect(getRequiredScope(tool)).toBe("read");
		}
		for (const tool of OPERATOR_TOOLS) {
			expect(getRequiredScope(tool)).toBe("operator");
		}
		for (const tool of ADMIN_TOOLS) {
			expect(getRequiredScope(tool)).toBe("admin");
		}
	});

	test("every TOOL_SCOPES entry is covered in our test arrays", () => {
		const allListed = [...READ_TOOLS, ...OPERATOR_TOOLS, ...ADMIN_TOOLS];
		const allDeclared = Object.keys(TOOL_SCOPES);
		expect(allListed.sort()).toEqual(allDeclared.sort());
	});

	test("dynamic / unknown tools require admin (same as unknown)", () => {
		// Dynamic tools are registered at runtime — their names won't be in TOOL_SCOPES
		expect(getRequiredScope("my_custom_dynamic_tool")).toBe("admin");
		expect(getRequiredScope("dynamic:some-plugin")).toBe("admin");
	});
});

// ==========================================================================
// 2. AuthMiddleware.hasScope — scope hierarchy tests
// ==========================================================================
describe("AuthMiddleware.hasScope — scope enforcement matrix", () => {
	let auth: AuthMiddleware;

	beforeEach(() => {
		auth = new AuthMiddleware(buildConfig());
	});

	// ---- Read token ----
	describe("read token", () => {
		test("can access all read tools", () => {
			for (const tool of READ_TOOLS) {
				const scope = getRequiredScope(tool);
				expect(auth.hasScope(readAuth, scope)).toBe(true);
			}
		});

		test("is blocked from operator tools", () => {
			for (const tool of OPERATOR_TOOLS) {
				const scope = getRequiredScope(tool);
				expect(auth.hasScope(readAuth, scope)).toBe(false);
			}
		});

		test("is blocked from admin tools", () => {
			for (const tool of ADMIN_TOOLS) {
				const scope = getRequiredScope(tool);
				expect(auth.hasScope(readAuth, scope)).toBe(false);
			}
		});

		test("is blocked from unknown tools (require admin)", () => {
			const scope = getRequiredScope("some_unknown_tool");
			expect(auth.hasScope(readAuth, scope)).toBe(false);
		});
	});

	// ---- Operator token ----
	describe("operator token", () => {
		test("can access all read tools", () => {
			for (const tool of READ_TOOLS) {
				const scope = getRequiredScope(tool);
				expect(auth.hasScope(operatorAuth, scope)).toBe(true);
			}
		});

		test("can access all operator tools", () => {
			for (const tool of OPERATOR_TOOLS) {
				const scope = getRequiredScope(tool);
				expect(auth.hasScope(operatorAuth, scope)).toBe(true);
			}
		});

		test("is blocked from admin tools", () => {
			for (const tool of ADMIN_TOOLS) {
				const scope = getRequiredScope(tool);
				expect(auth.hasScope(operatorAuth, scope)).toBe(false);
			}
		});

		test("is blocked from unknown tools (require admin)", () => {
			const scope = getRequiredScope("dynamic_plugin_xyz");
			expect(auth.hasScope(operatorAuth, scope)).toBe(false);
		});
	});

	// ---- Admin token ----
	describe("admin token", () => {
		test("can access all read tools", () => {
			for (const tool of READ_TOOLS) {
				const scope = getRequiredScope(tool);
				expect(auth.hasScope(adminAuth, scope)).toBe(true);
			}
		});

		test("can access all operator tools", () => {
			for (const tool of OPERATOR_TOOLS) {
				const scope = getRequiredScope(tool);
				expect(auth.hasScope(adminAuth, scope)).toBe(true);
			}
		});

		test("can access all admin tools", () => {
			for (const tool of ADMIN_TOOLS) {
				const scope = getRequiredScope(tool);
				expect(auth.hasScope(adminAuth, scope)).toBe(true);
			}
		});

		test("can access unknown / dynamic tools (admin required)", () => {
			const scope = getRequiredScope("any_unknown_tool");
			expect(auth.hasScope(adminAuth, scope)).toBe(true);
		});
	});

	// ---- Unauthenticated ----
	describe("unauthenticated caller", () => {
		test("has no scopes at all", () => {
			expect(auth.hasScope(unauthenticated, "read")).toBe(false);
			expect(auth.hasScope(unauthenticated, "operator")).toBe(false);
			expect(auth.hasScope(unauthenticated, "admin")).toBe(false);
		});
	});
});

// ==========================================================================
// 3. McpTransportManager.handleRequest — transport-layer scope enforcement
// ==========================================================================
describe("McpTransportManager.handleRequest — scope enforcement", () => {
	let authMiddleware: AuthMiddleware;
	let manager: McpTransportManager;

	// Minimal server factory stub — we only test checkToolScope, which runs
	// before the transport processes the body, so the server is never invoked
	// for scope-rejected requests.
	const stubServerFactory = () =>
		({
			connect: async () => {},
		}) as never;

	beforeEach(() => {
		authMiddleware = new AuthMiddleware(buildConfig());
		manager = new McpTransportManager(stubServerFactory, authMiddleware);
	});

	// Helper: inject a fake session so checkToolScope path is reached
	function injectSession(sessionId: string, clientName: string) {
		const fakeTransport = {
			handleRequest: async () => Response.json({ jsonrpc: "2.0", result: "ok", id: 1 }),
			close: async () => {},
			sessionId,
		};
		// Access private sessions map via bracket notation for testing
		(manager as any).sessions.set(sessionId, {
			transport: fakeTransport,
			clientName,
			createdAt: Date.now(),
		});
	}

	// ---- Unauthenticated is rejected immediately ----
	test("rejects unauthenticated requests with 401", async () => {
		const req = toolCallRequest("phantom_status");
		const res = await manager.handleRequest(req, unauthenticated);

		expect(res.status).toBe(401);
		const body = (await res.json()) as any;
		expect(body.error.code).toBe(-32001);
	});

	// ---- Read token: allowed for read tool ----
	test("read token can call a read-scoped tool", async () => {
		const sessionId = "session-read-ok";
		injectSession(sessionId, "read-client");

		const req = toolCallRequest("phantom_status", sessionId);
		const res = await manager.handleRequest(req, readAuth);

		// The fake transport returns 200 with result "ok"
		expect(res.status).toBe(200);
		const body = (await res.json()) as any;
		expect(body.result).toBe("ok");
	});

	// ---- Read token: blocked from operator tool ----
	test("read token is blocked from calling an operator-scoped tool", async () => {
		const sessionId = "session-read-blocked-op";
		injectSession(sessionId, "read-client");

		const req = toolCallRequest("phantom_ask", sessionId);
		const res = await manager.handleRequest(req, readAuth);

		expect(res.status).toBe(403);
		const body = (await res.json()) as any;
		expect(body.error.code).toBe(-32001);
		expect(body.error.message).toContain("Insufficient scope");
		expect(body.error.message).toContain("operator");
	});

	// ---- Read token: blocked from admin tool ----
	test("read token is blocked from calling an admin-scoped tool", async () => {
		const sessionId = "session-read-blocked-admin";
		injectSession(sessionId, "read-client");

		const req = toolCallRequest("phantom_register_tool", sessionId);
		const res = await manager.handleRequest(req, readAuth);

		expect(res.status).toBe(403);
		const body = (await res.json()) as any;
		expect(body.error.message).toContain("admin");
	});

	// ---- Operator token: allowed for read tool ----
	test("operator token can call a read-scoped tool", async () => {
		const sessionId = "session-op-read";
		injectSession(sessionId, "operator-client");

		const req = toolCallRequest("phantom_metrics", sessionId);
		const res = await manager.handleRequest(req, operatorAuth);

		expect(res.status).toBe(200);
	});

	// ---- Operator token: allowed for operator tool ----
	test("operator token can call an operator-scoped tool", async () => {
		const sessionId = "session-op-ok";
		injectSession(sessionId, "operator-client");

		const req = toolCallRequest("phantom_task_create", sessionId);
		const res = await manager.handleRequest(req, operatorAuth);

		expect(res.status).toBe(200);
	});

	// ---- Operator token: blocked from admin tool ----
	test("operator token is blocked from calling an admin-scoped tool", async () => {
		const sessionId = "session-op-blocked-admin";
		injectSession(sessionId, "operator-client");

		const req = toolCallRequest("phantom_unregister_tool", sessionId);
		const res = await manager.handleRequest(req, operatorAuth);

		expect(res.status).toBe(403);
		const body = (await res.json()) as any;
		expect(body.error.message).toContain("admin");
	});

	// ---- Admin token: allowed everywhere ----
	test("admin token can call a read-scoped tool", async () => {
		const sessionId = "session-admin-read";
		injectSession(sessionId, "admin-client");

		const req = toolCallRequest("phantom_status", sessionId);
		const res = await manager.handleRequest(req, adminAuth);

		expect(res.status).toBe(200);
	});

	test("admin token can call an operator-scoped tool", async () => {
		const sessionId = "session-admin-op";
		injectSession(sessionId, "admin-client");

		const req = toolCallRequest("phantom_ask", sessionId);
		const res = await manager.handleRequest(req, adminAuth);

		expect(res.status).toBe(200);
	});

	test("admin token can call an admin-scoped tool", async () => {
		const sessionId = "session-admin-admin";
		injectSession(sessionId, "admin-client");

		const req = toolCallRequest("phantom_register_tool", sessionId);
		const res = await manager.handleRequest(req, adminAuth);

		expect(res.status).toBe(200);
	});

	// ---- Unknown tool requires admin ----
	test("unknown tool name requires admin — read token blocked", async () => {
		const sessionId = "session-unknown-read";
		injectSession(sessionId, "read-client");

		const req = toolCallRequest("totally_unknown_tool", sessionId);
		const res = await manager.handleRequest(req, readAuth);

		expect(res.status).toBe(403);
		const body = (await res.json()) as any;
		expect(body.error.message).toContain("admin");
	});

	test("unknown tool name requires admin — operator token blocked", async () => {
		const sessionId = "session-unknown-op";
		injectSession(sessionId, "operator-client");

		const req = toolCallRequest("totally_unknown_tool", sessionId);
		const res = await manager.handleRequest(req, operatorAuth);

		expect(res.status).toBe(403);
	});

	test("unknown tool name requires admin — admin token allowed", async () => {
		const sessionId = "session-unknown-admin";
		injectSession(sessionId, "admin-client");

		const req = toolCallRequest("totally_unknown_tool", sessionId);
		const res = await manager.handleRequest(req, adminAuth);

		expect(res.status).toBe(200);
	});

	// ---- Dynamic tools require admin (same as unknown) ----
	test("dynamic tool requires admin — operator blocked", async () => {
		const sessionId = "session-dyn-op";
		injectSession(sessionId, "operator-client");

		const req = toolCallRequest("my_dynamic_plugin", sessionId);
		const res = await manager.handleRequest(req, operatorAuth);

		expect(res.status).toBe(403);
		const body = (await res.json()) as any;
		expect(body.error.message).toContain("Insufficient scope");
	});

	test("dynamic tool requires admin — admin allowed", async () => {
		const sessionId = "session-dyn-admin";
		injectSession(sessionId, "admin-client");

		const req = toolCallRequest("my_dynamic_plugin", sessionId);
		const res = await manager.handleRequest(req, adminAuth);

		expect(res.status).toBe(200);
	});

	// ---- Non tools/call methods pass through without scope check ----
	test("non tools/call POST passes through without scope rejection", async () => {
		const sessionId = "session-passthrough";
		injectSession(sessionId, "read-client");

		const req = new Request("http://localhost/mcp", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"mcp-session-id": sessionId,
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "resources/list",
				params: {},
			}),
		});
		const res = await manager.handleRequest(req, readAuth);

		// Should reach the fake transport, not be scope-blocked
		expect(res.status).toBe(200);
	});
});

// ==========================================================================
// 4. Session-to-client binding
// ==========================================================================
describe("McpTransportManager — session-to-client binding", () => {
	let authMiddleware: AuthMiddleware;
	let manager: McpTransportManager;

	const stubServerFactory = () =>
		({
			connect: async () => {},
		}) as never;

	beforeEach(() => {
		authMiddleware = new AuthMiddleware(buildConfig());
		manager = new McpTransportManager(stubServerFactory, authMiddleware);
	});

	function injectSession(sessionId: string, clientName: string) {
		const fakeTransport = {
			handleRequest: async () => Response.json({ jsonrpc: "2.0", result: "ok", id: 1 }),
			close: async () => {},
			sessionId,
		};
		(manager as any).sessions.set(sessionId, {
			transport: fakeTransport,
			clientName,
			createdAt: Date.now(),
		});
	}

	test("rejects request when a different client reuses an existing session", async () => {
		const sessionId = "session-owned-by-admin";
		injectSession(sessionId, "admin-client");

		// Operator client tries to use admin's session
		const req = toolCallRequest("phantom_status", sessionId);
		const res = await manager.handleRequest(req, operatorAuth);

		expect(res.status).toBe(403);
		const body = (await res.json()) as any;
		expect(body.error.code).toBe(-32001);
		expect(body.error.message).toContain("different client");
	});

	test("rejects request when read client reuses operator session", async () => {
		const sessionId = "session-owned-by-operator";
		injectSession(sessionId, "operator-client");

		const req = toolCallRequest("phantom_status", sessionId);
		const res = await manager.handleRequest(req, readAuth);

		expect(res.status).toBe(403);
		const body = (await res.json()) as any;
		expect(body.error.message).toContain("different client");
	});

	test("allows request when the same client reuses its own session", async () => {
		const sessionId = "session-owned-by-read";
		injectSession(sessionId, "read-client");

		const req = toolCallRequest("phantom_status", sessionId);
		const res = await manager.handleRequest(req, readAuth);

		// Same client, read-scoped tool — should succeed
		expect(res.status).toBe(200);
	});

	test("admin client cannot hijack operator session even with elevated scopes", async () => {
		const sessionId = "session-owned-by-operator-strict";
		injectSession(sessionId, "operator-client");

		const req = toolCallRequest("phantom_status", sessionId);
		const res = await manager.handleRequest(req, adminAuth);

		expect(res.status).toBe(403);
		const body = (await res.json()) as any;
		expect(body.error.message).toContain("different client");
	});
});
