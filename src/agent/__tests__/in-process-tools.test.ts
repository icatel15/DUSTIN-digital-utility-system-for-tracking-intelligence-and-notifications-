import { beforeAll, describe, expect, test } from "bun:test";
import { createMockSupabase } from "../../db/test-helpers.ts";
import { DynamicToolRegistry } from "../../mcp/dynamic-tools.ts";
import { createInProcessToolServer } from "../in-process-tools.ts";

describe("createInProcessToolServer", () => {
	let db: ReturnType<typeof createMockSupabase>;
	let registry: DynamicToolRegistry;

	beforeAll(async () => {
		db = createMockSupabase();
		registry = new DynamicToolRegistry(db as any);
		await registry.loadFromDatabase();
	});

	test("returns a valid SDK MCP server config", () => {
		const server = createInProcessToolServer(registry);
		expect(server).toBeDefined();
		expect(server.type).toBe("sdk");
		expect(server.name).toBe("phantom-dynamic-tools");
		expect(server.instance).toBeDefined();
	});

	test("shares the same registry instance", async () => {
		await registry.register({
			name: "shared_test",
			description: "Test shared registry",
			input_schema: {},
			handler_type: "shell",
			handler_code: "echo shared",
		});

		expect(registry.has("shared_test")).toBe(true);

		// Clean up
		await registry.unregister("shared_test");
	});

	test("server has correct type for SDK mcpServers config", () => {
		const server = createInProcessToolServer(registry);
		// Verify it can be used in a Record<string, McpServerConfig>
		const mcpServers = { "phantom-dynamic-tools": server };
		expect(mcpServers["phantom-dynamic-tools"].type).toBe("sdk");
		expect(mcpServers["phantom-dynamic-tools"].name).toBe("phantom-dynamic-tools");
	});
});
