import { describe, expect, test } from "bun:test";
import { createWebSearchToolServer } from "../tool.ts";

const defaultDeps = { dailyLimit: 50 };

describe("createWebSearchToolServer", () => {
	test("returns a valid SDK MCP server config", () => {
		const server = createWebSearchToolServer(defaultDeps);
		expect(server).toBeDefined();
		expect(server.type).toBe("sdk");
		expect(server.name).toBe("phantom-web-search");
		expect(server.instance).toBeDefined();
	});

	test("server has correct name", () => {
		const server = createWebSearchToolServer(defaultDeps);
		expect(server.name).toBe("phantom-web-search");
	});

	test("server config can be used in mcpServers record", () => {
		const server = createWebSearchToolServer(defaultDeps);
		const mcpServers = { "phantom-web-search": server };
		expect(mcpServers["phantom-web-search"].type).toBe("sdk");
		expect(mcpServers["phantom-web-search"].name).toBe("phantom-web-search");
	});

	test("factory produces independent instances", () => {
		const server1 = createWebSearchToolServer(defaultDeps);
		const server2 = createWebSearchToolServer(defaultDeps);
		expect(server1).not.toBe(server2);
		expect(server1.name).toBe(server2.name);
	});

	test("uses custom daily limit", () => {
		const server = createWebSearchToolServer({ dailyLimit: 100 });
		expect(server.name).toBe("phantom-web-search");
		expect(server.type).toBe("sdk");
	});
});
