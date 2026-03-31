import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { createMockSupabase } from "../../db/test-helpers.ts";
import { hashTokenSync } from "../config.ts";
import { DynamicToolRegistry } from "../dynamic-tools.ts";
import { PhantomMcpServer } from "../server.ts";

function createMockRuntime() {
	return {
		handleMessage: async (_ch: string, _conv: string, text: string) => ({
			text: `Mock: ${text}`,
			sessionId: "mock-session",
			cost: { totalUsd: 0.001, inputTokens: 100, outputTokens: 50, modelUsage: {} },
			durationMs: 100,
		}),
		getActiveSessionCount: () => 0,
		getLastTrackedFiles: () => [],
		setMemoryContextBuilder: () => {},
		setEvolvedConfig: () => {},
	};
}

const MCP_HEADERS = {
	"Content-Type": "application/json",
	Accept: "application/json, text/event-stream",
};

function mcpRequest(token: string, body: unknown, sessionId?: string): Request {
	const headers: Record<string, string> = { ...MCP_HEADERS, Authorization: `Bearer ${token}` };
	if (sessionId) headers["Mcp-Session-Id"] = sessionId;
	return new Request("http://localhost:3100/mcp", {
		method: "POST",
		headers,
		body: JSON.stringify(body),
	});
}

async function initSession(server: PhantomMcpServer, token: string): Promise<string> {
	const res = await server.handleRequest(
		mcpRequest(token, {
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2025-11-25",
				capabilities: {},
				clientInfo: { name: "dynamic-test", version: "1.0" },
			},
		}),
	);
	const sessionId = res.headers.get("mcp-session-id") ?? "";
	await server.handleRequest(mcpRequest(token, { jsonrpc: "2.0", method: "notifications/initialized" }, sessionId));
	return sessionId;
}

async function callTool(
	server: PhantomMcpServer,
	token: string,
	sessionId: string,
	toolName: string,
	args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const res = await server.handleRequest(
		mcpRequest(
			token,
			{ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: toolName, arguments: args } },
			sessionId,
		),
	);
	const body = (await res.json()) as Record<string, unknown>;
	const result = body.result as Record<string, unknown>;
	const content = result.content as Array<{ type: string; text: string }>;
	return JSON.parse(content[0].text);
}

describe("DynamicToolRegistry", () => {
	let db: ReturnType<typeof createMockSupabase>;

	beforeAll(() => {
		db = createMockSupabase();
	});

	test("starts with zero tools", async () => {
		const registry = new DynamicToolRegistry(db as any);
		await registry.loadFromDatabase();
		expect(registry.count()).toBe(0);
	});

	test("registers a shell tool", async () => {
		const registry = new DynamicToolRegistry(db as any);
		await registry.loadFromDatabase();
		const def = await registry.register({
			name: "test_hello",
			description: "Says hello",
			input_schema: { name: "string" },
			handler_type: "shell",
			handler_code: 'echo "Hello, world!"',
		});

		expect(def.name).toBe("test_hello");
		expect(def.description).toBe("Says hello");
		expect(def.handlerType).toBe("shell");
		expect(registry.has("test_hello")).toBe(true);
	});

	test("persists tools to database", async () => {
		const registry2 = new DynamicToolRegistry(db as any);
		await registry2.loadFromDatabase();
		expect(registry2.has("test_hello")).toBe(true);
		expect(registry2.count()).toBeGreaterThanOrEqual(1);
	});

	test("unregisters a tool", async () => {
		const registry = new DynamicToolRegistry(db as any);
		await registry.loadFromDatabase();
		await registry.register({
			name: "to_remove",
			description: "Will be removed",
			input_schema: {},
			handler_type: "shell",
			handler_code: 'echo "bye"',
		});
		expect(registry.has("to_remove")).toBe(true);

		const removed = await registry.unregister("to_remove");
		expect(removed).toBe(true);
		expect(registry.has("to_remove")).toBe(false);

		const registry3 = new DynamicToolRegistry(db as any);
		await registry3.loadFromDatabase();
		expect(registry3.has("to_remove")).toBe(false);
	});

	test("unregister returns false for unknown tools", async () => {
		const registry = new DynamicToolRegistry(db as any);
		await registry.loadFromDatabase();
		expect(await registry.unregister("nonexistent")).toBe(false);
	});

	test("rejects invalid tool names", async () => {
		const registry = new DynamicToolRegistry(db as any);
		await registry.loadFromDatabase();
		expect(
			registry.register({
				name: "Invalid Name",
				description: "Bad name",
				input_schema: {},
				handler_type: "shell",
				handler_code: "echo x",
			}),
		).rejects.toThrow();
	});

	test("rejects inline handler type", async () => {
		const registry = new DynamicToolRegistry(db as any);
		await registry.loadFromDatabase();
		expect(
			registry.register({
				name: "no_inline",
				description: "Inline is removed",
				input_schema: {},
				handler_type: "inline" as "shell",
			}),
		).rejects.toThrow();
	});

	test("requires handler_path for script type", async () => {
		const registry = new DynamicToolRegistry(db as any);
		await registry.loadFromDatabase();
		expect(
			registry.register({
				name: "no_path",
				description: "Missing path",
				input_schema: {},
				handler_type: "script",
			}),
		).rejects.toThrow("handler_path is required");
	});

	test("requires handler_code for shell type", async () => {
		const registry = new DynamicToolRegistry(db as any);
		await registry.loadFromDatabase();
		expect(
			registry.register({
				name: "no_shell_code",
				description: "Missing code",
				input_schema: {},
				handler_type: "shell",
			}),
		).rejects.toThrow("handler_code is required");
	});

	test("getAll returns all registered tools", async () => {
		const freshDb = createMockSupabase();

		const registry = new DynamicToolRegistry(freshDb as any);
		await registry.loadFromDatabase();
		await registry.register({
			name: "tool_a",
			description: "Tool A",
			input_schema: {},
			handler_type: "shell",
			handler_code: "echo a",
		});
		await registry.register({
			name: "tool_b",
			description: "Tool B",
			input_schema: {},
			handler_type: "shell",
			handler_code: "echo b",
		});

		const all = registry.getAll();
		expect(all).toHaveLength(2);
		expect(all.map((t) => t.name)).toEqual(["tool_a", "tool_b"]);
	});

	test("upserts on duplicate name", async () => {
		const freshDb = createMockSupabase();

		const registry = new DynamicToolRegistry(freshDb as any);
		await registry.loadFromDatabase();
		await registry.register({
			name: "update_me",
			description: "Version 1",
			input_schema: {},
			handler_type: "shell",
			handler_code: "echo v1",
		});

		await registry.register({
			name: "update_me",
			description: "Version 2",
			input_schema: {},
			handler_type: "shell",
			handler_code: "echo v2",
		});

		expect(registry.count()).toBe(1);
		expect(registry.get("update_me")?.description).toBe("Version 2");
	});
});

describe("Dynamic Tools via MCP Protocol", () => {
	let db: ReturnType<typeof createMockSupabase>;
	let mcpServer: PhantomMcpServer;
	const adminToken = "dynamic-tools-test-token";
	let tmpDir: string;

	beforeAll(async () => {
		tmpDir = join(import.meta.dir, "tmp-dynamic-tools-test");
		if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

		const mcpConfig = {
			tokens: [{ name: "dynamic-tester", hash: hashTokenSync(adminToken), scopes: ["read", "operator", "admin"] }],
			rate_limit: { requests_per_minute: 100, burst: 50 },
		};
		writeFileSync(join(tmpDir, "mcp.yaml"), stringify(mcpConfig));

		db = createMockSupabase();

		mcpServer = await PhantomMcpServer.create(
			{
				config: {
					name: "dynamic-test-phantom",
					port: 3100,
					role: "swe",
					model: "claude-opus-4-6",
					effort: "max" as const,
					max_budget_usd: 0,
					timeout_minutes: 240,
				},
				db: db as any,
				startedAt: Date.now(),
				runtime: createMockRuntime() as never,
				memory: null,
				evolution: null,
			},
			join(tmpDir, "mcp.yaml"),
		);
	});

	afterAll(async () => {
		await mcpServer.close();
		if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
	});

	test("phantom_register_tool registers a new shell tool", async () => {
		const sessionId = await initSession(mcpServer, adminToken);
		const result = await callTool(mcpServer, adminToken, sessionId, "phantom_register_tool", {
			name: "phantom_hello",
			description: "A test tool that says hello",
			input_schema: { name: "string" },
			handler_type: "shell",
			handler_code: 'echo "Hello, $(echo $TOOL_INPUT | jq -r .name)!"',
		});

		expect(result.registered).toBe(true);
		expect(result.name).toBe("phantom_hello");
	});

	test("newly registered tool appears in tools/list on new session", async () => {
		const sessionId = await initSession(mcpServer, adminToken);
		const res = await mcpServer.handleRequest(
			mcpRequest(adminToken, { jsonrpc: "2.0", id: 10, method: "tools/list" }, sessionId),
		);
		const body = (await res.json()) as Record<string, unknown>;
		const result = body.result as { tools: Array<{ name: string }> };
		const toolNames = result.tools.map((t) => t.name);

		expect(toolNames).toContain("phantom_hello");
		expect(toolNames).toContain("phantom_register_tool");
		expect(toolNames).toContain("phantom_unregister_tool");
		expect(toolNames).toContain("phantom_list_dynamic_tools");
	});

	test("dynamically registered shell tool can be called", async () => {
		const sessionId = await initSession(mcpServer, adminToken);
		const res = await mcpServer.handleRequest(
			mcpRequest(
				adminToken,
				{
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: { name: "phantom_hello", arguments: { name: "Cheema" } },
				},
				sessionId,
			),
		);
		const body = (await res.json()) as Record<string, unknown>;
		const result = body.result as Record<string, unknown>;
		const content = result.content as Array<{ type: string; text: string }>;

		expect(content[0].text).toContain("Hello");
	});

	test("phantom_list_dynamic_tools returns registered tools", async () => {
		const sessionId = await initSession(mcpServer, adminToken);
		const result = await callTool(mcpServer, adminToken, sessionId, "phantom_list_dynamic_tools", {});

		expect(result.count).toBeGreaterThanOrEqual(1);
		const tools = result.tools as Array<{ name: string }>;
		expect(tools.some((t) => t.name === "phantom_hello")).toBe(true);
	});

	test("phantom_unregister_tool removes a tool", async () => {
		let sessionId = await initSession(mcpServer, adminToken);
		await callTool(mcpServer, adminToken, sessionId, "phantom_register_tool", {
			name: "temp_tool",
			description: "Temporary",
			input_schema: {},
			handler_type: "shell",
			handler_code: "echo temp",
		});

		sessionId = await initSession(mcpServer, adminToken);
		const result = await callTool(mcpServer, adminToken, sessionId, "phantom_unregister_tool", {
			name: "temp_tool",
		});

		expect(result.removed).toBe(true);
	});

	test("tool persists across registry reinstantiation", () => {
		const registry = mcpServer.getDynamicToolRegistry();
		expect(registry.has("phantom_hello")).toBe(true);
	});

	test("phantom_register_tool rejects invalid names", async () => {
		const sessionId = await initSession(mcpServer, adminToken);
		const result = await callTool(mcpServer, adminToken, sessionId, "phantom_register_tool", {
			name: "Invalid Name",
			description: "Bad",
			input_schema: {},
			handler_type: "shell",
			handler_code: "echo x",
		});

		expect(result.error).toBeDefined();
	});
});
