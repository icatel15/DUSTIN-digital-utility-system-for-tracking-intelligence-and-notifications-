import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AgentResponse } from "../../agent/events.ts";
import type { AgentRuntime } from "../../agent/runtime.ts";
import type { AuditLogger } from "../../mcp/audit.ts";
import { RateLimiter } from "../../mcp/rate-limiter.ts";
import type { AuditEntry } from "../../mcp/types.ts";
import { setTriggerDeps, startServer } from "../server.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-trigger-secret-abc123";

/** Minimal PhantomConfig to boot a server. */
function makeConfig(port: number) {
	return {
		name: "test-phantom",
		port,
		role: "swe",
		model: "claude-sonnet-4-6",
		effort: "max" as const,
		max_budget_usd: 0,
		timeout_minutes: 240,
	};
}

/** Standard AgentResponse returned by the mock runtime. */
function fakeAgentResponse(text = "mock response"): AgentResponse {
	return {
		text,
		sessionId: "sess-1",
		cost: {
			totalUsd: 0.005,
			inputTokens: 100,
			outputTokens: 50,
			modelUsage: {},
		},
		durationMs: 42,
	};
}

/** Creates a mock AgentRuntime with a controllable handleMessage. */
function makeMockRuntime(): AgentRuntime {
	return {
		handleMessage: mock(() => Promise.resolve(fakeAgentResponse())),
	} as unknown as AgentRuntime;
}

/** Captured audit entries. */
type CapturedEntry = Omit<AuditEntry, "id" | "timestamp">;

/** Creates a mock AuditLogger that captures all log() calls. */
function makeMockAudit(): { audit: AuditLogger; entries: CapturedEntry[] } {
	const entries: CapturedEntry[] = [];
	const audit = {
		log: mock((entry: CapturedEntry) => {
			entries.push(entry);
			return Promise.resolve();
		}),
	} as unknown as AuditLogger;
	return { audit, entries };
}

/** Helper to POST to /trigger with an optional bearer token. */
function triggerRequest(port: number, body: Record<string, unknown>, token?: string): Promise<Response> {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}
	return fetch(`http://localhost:${port}/trigger`, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
	});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /trigger authentication", () => {
	let server: ReturnType<typeof Bun.serve>;
	let port: number;
	let savedSecret: string | undefined;

	beforeEach(() => {
		savedSecret = process.env.TRIGGER_SECRET;
		// Allocate a random high port to avoid collisions across parallel runs.
		port = 10_000 + Math.floor(Math.random() * 50_000);
	});

	afterEach(() => {
		// Restore env
		if (savedSecret !== undefined) {
			process.env.TRIGGER_SECRET = savedSecret;
		} else {
			process.env.TRIGGER_SECRET = undefined;
		}
		// Reset trigger deps to avoid leaking between tests
		setTriggerDeps(null as unknown as Parameters<typeof setTriggerDeps>[0]);
		// Stop server
		if (server) {
			server.stop(true);
		}
	});

	// -----------------------------------------------------------------------
	// 1. TRIGGER_SECRET unset -> 404
	// -----------------------------------------------------------------------
	test("returns 404 when TRIGGER_SECRET is unset", async () => {
		process.env.TRIGGER_SECRET = undefined;

		const runtime = makeMockRuntime();
		setTriggerDeps({ runtime });

		server = startServer(makeConfig(port), Date.now());

		const res = await triggerRequest(port, { task: "hello" }, "anything");

		expect(res.status).toBe(404);
		const json = (await res.json()) as { error: string };
		expect(json.error).toBe("Not found");
	});

	// -----------------------------------------------------------------------
	// 2. No bearer token -> 401
	// -----------------------------------------------------------------------
	test("returns 401 without bearer token", async () => {
		process.env.TRIGGER_SECRET = TEST_SECRET;

		const runtime = makeMockRuntime();
		const { audit } = makeMockAudit();
		setTriggerDeps({ runtime, audit });

		server = startServer(makeConfig(port), Date.now());

		const res = await triggerRequest(port, { task: "hello" });

		expect(res.status).toBe(401);
		const json = (await res.json()) as { status: string; message: string };
		expect(json.message).toBe("Unauthorized");
	});

	// -----------------------------------------------------------------------
	// 3. Wrong token -> 401
	// -----------------------------------------------------------------------
	test("returns 401 with wrong token", async () => {
		process.env.TRIGGER_SECRET = TEST_SECRET;

		const runtime = makeMockRuntime();
		const { audit } = makeMockAudit();
		setTriggerDeps({ runtime, audit });

		server = startServer(makeConfig(port), Date.now());

		const res = await triggerRequest(port, { task: "hello" }, "wrong-secret");

		expect(res.status).toBe(401);
		const json = (await res.json()) as { status: string; message: string };
		expect(json.message).toBe("Unauthorized");
	});

	// -----------------------------------------------------------------------
	// 4. Correct token -> 200 (mocked runtime)
	// -----------------------------------------------------------------------
	test("returns 200 with correct token", async () => {
		process.env.TRIGGER_SECRET = TEST_SECRET;

		const runtime = makeMockRuntime();
		setTriggerDeps({ runtime });

		server = startServer(makeConfig(port), Date.now());

		const res = await triggerRequest(port, { task: "summarize project" }, TEST_SECRET);

		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			status: string;
			response: string;
			cost: number;
			durationMs: number;
		};
		expect(json.status).toBe("ok");
		expect(json.response).toBe("mock response");
		expect(json.cost).toBe(0.005);
		expect(json.durationMs).toBe(42);
	});

	// -----------------------------------------------------------------------
	// 5. Rate limited after burst -> 429
	// -----------------------------------------------------------------------
	test("returns 429 when rate limited after burst", async () => {
		process.env.TRIGGER_SECRET = TEST_SECRET;

		const runtime = makeMockRuntime();
		// Allow exactly 2 requests (requests_per_minute=0 so no refill, burst=2 -> 2 tokens total).
		const rateLimiter = new RateLimiter({ requests_per_minute: 0, burst: 2 });
		setTriggerDeps({ runtime, rateLimiter });

		server = startServer(makeConfig(port), Date.now());

		// First two requests should succeed
		const res1 = await triggerRequest(port, { task: "req 1" }, TEST_SECRET);
		expect(res1.status).toBe(200);

		const res2 = await triggerRequest(port, { task: "req 2" }, TEST_SECRET);
		expect(res2.status).toBe(200);

		// Third request should be rate limited
		const res3 = await triggerRequest(port, { task: "req 3" }, TEST_SECRET);
		expect(res3.status).toBe(429);

		const json = (await res3.json()) as { status: string; message: string };
		expect(json.message).toBe("Rate limit exceeded");
		expect(res3.headers.get("Retry-After")).toBeTruthy();
	});

	// -----------------------------------------------------------------------
	// 6. Accepted request writes an audit log entry
	// -----------------------------------------------------------------------
	test("accepted request writes an audit log entry", async () => {
		process.env.TRIGGER_SECRET = TEST_SECRET;

		const runtime = makeMockRuntime();
		const { audit, entries } = makeMockAudit();
		setTriggerDeps({ runtime, audit });

		server = startServer(makeConfig(port), Date.now());

		const res = await triggerRequest(port, { task: "run diagnostics", source: "cron" }, TEST_SECRET);

		expect(res.status).toBe(200);
		expect(entries).toHaveLength(1);

		const entry = entries[0];
		expect(entry.client_name).toBe("trigger");
		expect(entry.method).toBe("POST /trigger");
		expect(entry.status).toBe("success");
		expect(entry.cost_usd).toBe(0.005);
		expect(entry.duration_ms).toBe(42);
		// input_summary should contain metadata
		expect(entry.input_summary).toContain("source=cron");
		expect(entry.input_summary).toContain("len=");
		expect(entry.input_summary).toContain("hash=");
		// output_summary should contain conversationId
		expect(entry.output_summary).toContain("conversationId=trigger:");
	});

	// -----------------------------------------------------------------------
	// 7. Rejected auth writes an audit log entry
	// -----------------------------------------------------------------------
	test("rejected auth writes an audit log entry", async () => {
		process.env.TRIGGER_SECRET = TEST_SECRET;

		const runtime = makeMockRuntime();
		const { audit, entries } = makeMockAudit();
		setTriggerDeps({ runtime, audit });

		server = startServer(makeConfig(port), Date.now());

		const res = await triggerRequest(port, { task: "hack attempt" }, "bad-token");

		expect(res.status).toBe(401);
		expect(entries).toHaveLength(1);

		const entry = entries[0];
		expect(entry.client_name).toBe("trigger:unauthenticated");
		expect(entry.method).toBe("POST /trigger");
		expect(entry.status).toBe("error");
		expect(entry.output_summary).toBe("Authentication failed");
		// No input data should be logged for rejected auth
		expect(entry.input_summary).toBeNull();
	});

	// -----------------------------------------------------------------------
	// 8. Audit entry stores metadata only, NOT raw task text
	// -----------------------------------------------------------------------
	test("audit entry stores metadata only and does NOT contain raw task text", async () => {
		process.env.TRIGGER_SECRET = TEST_SECRET;

		const runtime = makeMockRuntime();
		const { audit, entries } = makeMockAudit();
		setTriggerDeps({ runtime, audit });

		server = startServer(makeConfig(port), Date.now());

		const sensitiveTask = "Send the financial report for Q4 with account number 1234-5678";

		const res = await triggerRequest(port, { task: sensitiveTask, source: "api" }, TEST_SECRET);

		expect(res.status).toBe(200);
		expect(entries).toHaveLength(1);

		const entry = entries[0];

		// The raw task text must NOT appear anywhere in the audit entry
		expect(entry.input_summary).not.toContain(sensitiveTask);
		expect(entry.output_summary).not.toContain(sensitiveTask);

		// Verify it uses a hash instead
		expect(entry.input_summary).toContain("hash=");
		expect(entry.input_summary).toContain(`len=${sensitiveTask.length}`);
		expect(entry.input_summary).toContain("source=api");

		// Double-check: no substring of the task beyond metadata keywords appears
		// The task contains "financial report" -- ensure that is not in the audit
		expect(entry.input_summary).not.toContain("financial report");
		expect(entry.input_summary).not.toContain("account number");
		expect(entry.input_summary).not.toContain("1234-5678");

		// Verify tool_name and resource_uri are null (trigger doesn't use tools)
		expect(entry.tool_name).toBeNull();
		expect(entry.resource_uri).toBeNull();
	});
});
