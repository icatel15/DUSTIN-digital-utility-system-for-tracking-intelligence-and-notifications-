import { describe, expect, test } from "bun:test";
import type { MemoryHealth } from "../../memory/types.ts";

/**
 * Extract the health status logic from server.ts for isolated testing.
 * This must mirror the logic in startServer's /health handler exactly.
 */
function computeHealthStatus(memory: MemoryHealth): string {
	const allHealthy = memory.qdrant && memory.embeddings;
	const someHealthy = memory.qdrant || memory.embeddings;
	return allHealthy ? "ok" : someHealthy ? "degraded" : memory.configured ? "down" : "ok";
}

describe("health status logic", () => {
	test("both healthy and configured -> ok", () => {
		expect(computeHealthStatus({ qdrant: true, embeddings: true, configured: true })).toBe("ok");
	});

	test("qdrant up, embeddings down, configured -> degraded", () => {
		expect(computeHealthStatus({ qdrant: true, embeddings: false, configured: true })).toBe("degraded");
	});

	test("qdrant down, embeddings up, configured -> degraded", () => {
		expect(computeHealthStatus({ qdrant: false, embeddings: true, configured: true })).toBe("degraded");
	});

	test("both down when configured -> down (the bug fix)", () => {
		expect(computeHealthStatus({ qdrant: false, embeddings: false, configured: true })).toBe("down");
	});

	test("both down when not configured -> ok (memory intentionally not set up)", () => {
		expect(computeHealthStatus({ qdrant: false, embeddings: false, configured: false })).toBe("ok");
	});
});
