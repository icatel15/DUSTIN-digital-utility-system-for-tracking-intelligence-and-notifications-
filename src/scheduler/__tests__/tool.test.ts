import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createMockSupabase } from "../../db/test-helpers.ts";
import { Scheduler } from "../service.ts";
import { createSchedulerToolServer } from "../tool.ts";

function createMockRuntime() {
	return {
		handleMessage: mock(async (_channel: string, _conversationId: string, _text: string) => ({
			text: "Mock agent response",
			sessionId: "mock-session",
			cost: { totalUsd: 0.01, inputTokens: 100, outputTokens: 50, modelUsage: {} },
			durationMs: 500,
		})),
		setMemoryContextBuilder: mock(() => {}),
		setEvolvedConfig: mock(() => {}),
		setRoleTemplate: mock(() => {}),
		setOnboardingPrompt: mock(() => {}),
		setMcpServers: mock(() => {}),
		getLastTrackedFiles: mock(() => []),
		getActiveSessionCount: mock(() => 0),
	};
}

describe("createSchedulerToolServer", () => {
	let db: ReturnType<typeof createMockSupabase>;
	let mockRuntime: ReturnType<typeof createMockRuntime>;
	let scheduler: Scheduler;

	beforeEach(() => {
		db = createMockSupabase();
		mockRuntime = createMockRuntime();
		scheduler = new Scheduler({ db: db as any, runtime: mockRuntime as never });
	});

	test("returns a valid SDK MCP server config", () => {
		const server = createSchedulerToolServer(scheduler);
		expect(server).toBeDefined();
		expect(server.type).toBe("sdk");
		expect(server.name).toBe("phantom-scheduler");
		expect(server.instance).toBeDefined();
	});

	test("scheduler tool is accessible via the server", () => {
		const server = createSchedulerToolServer(scheduler);
		expect(server.name).toBe("phantom-scheduler");
	});

	test("create action via scheduler creates a job", async () => {
		const job = await scheduler.createJob({
			name: "Tool Test",
			schedule: { kind: "every", intervalMs: 120_000 },
			task: "Tool test task",
		});

		expect(job.id).toBeTruthy();
		expect(job.name).toBe("Tool Test");

		const listed = await scheduler.listJobs();
		expect(listed.length).toBe(1);
	});

	test("list action via scheduler returns jobs", async () => {
		await scheduler.createJob({ name: "J1", schedule: { kind: "every", intervalMs: 60_000 }, task: "T1" });
		await scheduler.createJob({ name: "J2", schedule: { kind: "every", intervalMs: 60_000 }, task: "T2" });

		const jobs = await scheduler.listJobs();
		expect(jobs.length).toBe(2);
	});

	test("delete action via scheduler removes a job", async () => {
		const job = await scheduler.createJob({
			name: "Deletable",
			schedule: { kind: "every", intervalMs: 60_000 },
			task: "D",
		});

		const deleted = await scheduler.deleteJob(job.id);
		expect(deleted).toBe(true);
		expect((await scheduler.listJobs()).length).toBe(0);
	});

	test("run action via scheduler triggers the job", async () => {
		const job = await scheduler.createJob({
			name: "Runnable",
			schedule: { kind: "every", intervalMs: 60_000 },
			task: "Run me",
		});

		const result = await scheduler.runJobNow(job.id);
		expect(result).toBe("Mock agent response");
		expect(mockRuntime.handleMessage).toHaveBeenCalled();
	});

	test("server config can be used in mcpServers record", () => {
		const server = createSchedulerToolServer(scheduler);
		const mcpServers = { "phantom-scheduler": server };
		expect(mcpServers["phantom-scheduler"].type).toBe("sdk");
		expect(mcpServers["phantom-scheduler"].name).toBe("phantom-scheduler");
	});
});
