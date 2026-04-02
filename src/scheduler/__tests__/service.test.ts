import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createMockSupabase } from "../../db/test-helpers.ts";
import { Scheduler } from "../service.ts";

function createMockRuntime() {
	return {
		handleMessage: mock(async (_channel: string, _conversationId: string, _text: string) => ({
			text: "Mock response from agent",
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

function createMockSlackChannel() {
	return {
		sendDm: mock(async (_userId: string, _text: string) => "mock-ts"),
		postToChannel: mock(async (_channelId: string, _text: string) => "mock-ts"),
	};
}

function createMockTelegramChannel() {
	return {
		send: mock(async (_conversationId: string, _message: { text: string }) => ({
			id: "mock-msg-id",
			channelId: "telegram",
			conversationId: _conversationId,
			timestamp: new Date(),
		})),
	};
}

describe("Scheduler", () => {
	let db: ReturnType<typeof createMockSupabase>;
	let mockRuntime: ReturnType<typeof createMockRuntime>;

	beforeEach(() => {
		db = createMockSupabase();
		mockRuntime = createMockRuntime();
	});

	test("createJob inserts a job and returns it", async () => {
		const scheduler = new Scheduler({ db: db as any, runtime: mockRuntime as never });

		const job = await scheduler.createJob({
			name: "Test Job",
			description: "A test job",
			schedule: { kind: "every", intervalMs: 60_000 },
			task: "Tell me a joke",
		});

		expect(job.id).toBeTruthy();
		expect(job.name).toBe("Test Job");
		expect(job.description).toBe("A test job");
		expect(job.enabled).toBe(true);
		expect(job.schedule).toEqual({ kind: "every", intervalMs: 60_000 });
		expect(job.task).toBe("Tell me a joke");
		expect(job.status).toBe("active");
		expect(job.runCount).toBe(0);
		expect(job.nextRunAt).toBeTruthy();
		expect(job.delivery).toEqual({ channel: "slack", target: "owner" });
	});

	test("createJob with at schedule computes correct next run", async () => {
		const scheduler = new Scheduler({ db: db as any, runtime: mockRuntime as never });
		const future = new Date(Date.now() + 3_600_000).toISOString();

		const job = await scheduler.createJob({
			name: "One-shot",
			schedule: { kind: "at", at: future },
			task: "Remind me",
			deleteAfterRun: true,
		});

		expect(job.nextRunAt).toBe(future);
		expect(job.deleteAfterRun).toBe(true);
	});

	test("createJob with cron schedule", async () => {
		const scheduler = new Scheduler({ db: db as any, runtime: mockRuntime as never });

		const job = await scheduler.createJob({
			name: "Daily Report",
			schedule: { kind: "cron", expr: "0 9 * * 1-5", tz: "America/Los_Angeles" },
			task: "Summarize PRs",
		});

		expect(job.schedule).toEqual({ kind: "cron", expr: "0 9 * * 1-5", tz: "America/Los_Angeles" });
		expect(job.nextRunAt).toBeTruthy();
	});

	test("createJob with custom delivery", async () => {
		const scheduler = new Scheduler({ db: db as any, runtime: mockRuntime as never });

		const job = await scheduler.createJob({
			name: "Channel Post",
			schedule: { kind: "every", intervalMs: 300_000 },
			task: "Post update",
			delivery: { channel: "slack", target: "C04ABC123" },
		});

		expect(job.delivery).toEqual({ channel: "slack", target: "C04ABC123" });
	});

	test("listJobs returns all jobs", async () => {
		const scheduler = new Scheduler({ db: db as any, runtime: mockRuntime as never });

		await scheduler.createJob({ name: "Job 1", schedule: { kind: "every", intervalMs: 60_000 }, task: "Task 1" });
		await scheduler.createJob({ name: "Job 2", schedule: { kind: "every", intervalMs: 120_000 }, task: "Task 2" });
		await scheduler.createJob({ name: "Job 3", schedule: { kind: "every", intervalMs: 180_000 }, task: "Task 3" });

		const jobs = await scheduler.listJobs();
		expect(jobs.length).toBe(3);
	});

	test("getJob returns a specific job by ID", async () => {
		const scheduler = new Scheduler({ db: db as any, runtime: mockRuntime as never });
		const created = await scheduler.createJob({
			name: "Findable",
			schedule: { kind: "every", intervalMs: 60_000 },
			task: "Find me",
		});

		const found = await scheduler.getJob(created.id);
		expect(found).not.toBeNull();
		expect(found?.name).toBe("Findable");
	});

	test("getJob returns null for non-existent ID", async () => {
		const scheduler = new Scheduler({ db: db as any, runtime: mockRuntime as never });
		const found = await scheduler.getJob("non-existent-id");
		expect(found).toBeNull();
	});

	test("deleteJob removes a job", async () => {
		const scheduler = new Scheduler({ db: db as any, runtime: mockRuntime as never });
		const job = await scheduler.createJob({
			name: "Deletable",
			schedule: { kind: "every", intervalMs: 60_000 },
			task: "Delete me",
		});

		const deleted = await scheduler.deleteJob(job.id);
		expect(deleted).toBe(true);
		expect(await scheduler.getJob(job.id)).toBeNull();
	});

	test("deleteJob returns false for non-existent ID", async () => {
		const scheduler = new Scheduler({ db: db as any, runtime: mockRuntime as never });
		const deleted = await scheduler.deleteJob("non-existent-id");
		expect(deleted).toBe(false);
	});

	test("runJobNow executes the job and calls runtime", async () => {
		const scheduler = new Scheduler({ db: db as any, runtime: mockRuntime as never });
		const job = await scheduler.createJob({
			name: "Immediate",
			schedule: { kind: "every", intervalMs: 60_000 },
			task: "Run now",
		});

		const result = await scheduler.runJobNow(job.id);
		expect(result).toBe("Mock response from agent");
		expect(mockRuntime.handleMessage).toHaveBeenCalledTimes(1);
	});

	test("runJobNow updates job state after execution", async () => {
		const scheduler = new Scheduler({ db: db as any, runtime: mockRuntime as never });
		const job = await scheduler.createJob({
			name: "Tracked",
			schedule: { kind: "every", intervalMs: 60_000 },
			task: "Track me",
		});

		await scheduler.runJobNow(job.id);

		const updated = await scheduler.getJob(job.id);
		expect(updated?.runCount).toBe(1);
		expect(updated?.lastRunAt).toBeTruthy();
		expect(updated?.lastRunStatus).toBe("ok");
		expect(updated?.consecutiveErrors).toBe(0);
	});

	test("runJobNow delivers result to Slack owner", async () => {
		const mockSlack = createMockSlackChannel();
		const scheduler = new Scheduler({
			db: db as any,
			runtime: mockRuntime as never,
			slackChannel: mockSlack as never,
			ownerUserId: "U_OWNER",
		});

		const job = await scheduler.createJob({
			name: "Delivered",
			schedule: { kind: "every", intervalMs: 60_000 },
			task: "Deliver me",
		});
		await scheduler.runJobNow(job.id);

		expect(mockSlack.sendDm).toHaveBeenCalledWith("U_OWNER", "Mock response from agent");
	});

	test("runJobNow delivers to specific channel", async () => {
		const mockSlack = createMockSlackChannel();
		const scheduler = new Scheduler({
			db: db as any,
			runtime: mockRuntime as never,
			slackChannel: mockSlack as never,
			ownerUserId: "U_OWNER",
		});

		const job = await scheduler.createJob({
			name: "Channel Post",
			schedule: { kind: "every", intervalMs: 60_000 },
			task: "Post to channel",
			delivery: { channel: "slack", target: "C04ABC123" },
		});
		await scheduler.runJobNow(job.id);

		expect(mockSlack.postToChannel).toHaveBeenCalledWith("C04ABC123", "Mock response from agent");
	});

	test("runJobNow with delivery=none does not call Slack", async () => {
		const mockSlack = createMockSlackChannel();
		const scheduler = new Scheduler({
			db: db as any,
			runtime: mockRuntime as never,
			slackChannel: mockSlack as never,
			ownerUserId: "U_OWNER",
		});

		const job = await scheduler.createJob({
			name: "Silent",
			schedule: { kind: "every", intervalMs: 60_000 },
			task: "Silent task",
			delivery: { channel: "none", target: "owner" },
		});
		await scheduler.runJobNow(job.id);

		expect(mockSlack.sendDm).not.toHaveBeenCalled();
		expect(mockSlack.postToChannel).not.toHaveBeenCalled();
	});

	test("runJobNow throws for non-existent job", async () => {
		const scheduler = new Scheduler({ db: db as any, runtime: mockRuntime as never });
		await expect(scheduler.runJobNow("non-existent")).rejects.toThrow("Job not found");
	});

	test("runJobNow handles runtime errors gracefully", async () => {
		const errorRuntime = createMockRuntime();
		errorRuntime.handleMessage.mockImplementation(async () => ({
			text: "Error: Something went wrong",
			sessionId: "err-session",
			cost: { totalUsd: 0, inputTokens: 0, outputTokens: 0, modelUsage: {} },
			durationMs: 100,
		}));

		const scheduler = new Scheduler({ db: db as any, runtime: errorRuntime as never });
		const job = await scheduler.createJob({
			name: "Failing",
			schedule: { kind: "every", intervalMs: 60_000 },
			task: "Fail please",
		});

		const result = await scheduler.runJobNow(job.id);
		expect(result).toBe("Error: Something went wrong");

		const updated = await scheduler.getJob(job.id);
		expect(updated?.lastRunStatus).toBe("error");
		expect(updated?.consecutiveErrors).toBe(1);
	});

	test("start and stop lifecycle", async () => {
		const scheduler = new Scheduler({ db: db as any, runtime: mockRuntime as never });
		expect(scheduler.isRunning()).toBe(false);

		await scheduler.start();
		expect(scheduler.isRunning()).toBe(true);

		scheduler.stop();
		expect(scheduler.isRunning()).toBe(false);
	});

	test("jobs persist across scheduler instances", async () => {
		const scheduler1 = new Scheduler({ db: db as any, runtime: mockRuntime as never });
		const job = await scheduler1.createJob({
			name: "Persistent",
			schedule: { kind: "every", intervalMs: 60_000 },
			task: "Persist",
		});

		const scheduler2 = new Scheduler({ db: db as any, runtime: mockRuntime as never });
		const found = await scheduler2.getJob(job.id);
		expect(found).not.toBeNull();
		expect(found?.name).toBe("Persistent");
	});

	test("setSlackChannel updates delivery target", async () => {
		const scheduler = new Scheduler({ db: db as any, runtime: mockRuntime as never });
		const mockSlack = createMockSlackChannel();

		scheduler.setSlackChannel(mockSlack as never, "U_LATE_OWNER");

		const job = await scheduler.createJob({
			name: "Late Slack",
			schedule: { kind: "every", intervalMs: 60_000 },
			task: "Late delivery",
		});
		await scheduler.runJobNow(job.id);

		expect(mockSlack.sendDm).toHaveBeenCalledWith("U_LATE_OWNER", "Mock response from agent");
	});

	test("createJob with telegram delivery", async () => {
		const scheduler = new Scheduler({ db: db as any, runtime: mockRuntime as never });

		const job = await scheduler.createJob({
			name: "Telegram Post",
			schedule: { kind: "every", intervalMs: 60_000 },
			task: "Post to Telegram",
			delivery: { channel: "telegram", target: "8669996556" },
		});

		expect(job.delivery).toEqual({ channel: "telegram", target: "8669996556" });
	});

	test("runJobNow delivers result to Telegram owner", async () => {
		const mockTelegram = createMockTelegramChannel();
		const scheduler = new Scheduler({
			db: db as any,
			runtime: mockRuntime as never,
			telegramChannel: mockTelegram as never,
			ownerTelegramChatId: "8669996556",
		});

		const job = await scheduler.createJob({
			name: "TG Owner Delivery",
			schedule: { kind: "every", intervalMs: 60_000 },
			task: "Deliver to TG owner",
			delivery: { channel: "telegram", target: "owner" },
		});
		await scheduler.runJobNow(job.id);

		expect(mockTelegram.send).toHaveBeenCalledWith("telegram:8669996556", {
			text: "Mock response from agent",
		});
	});

	test("runJobNow delivers to specific Telegram chat ID", async () => {
		const mockTelegram = createMockTelegramChannel();
		const scheduler = new Scheduler({
			db: db as any,
			runtime: mockRuntime as never,
			telegramChannel: mockTelegram as never,
			ownerTelegramChatId: "8669996556",
		});

		const job = await scheduler.createJob({
			name: "TG Direct Delivery",
			schedule: { kind: "every", intervalMs: 60_000 },
			task: "Deliver to specific TG chat",
			delivery: { channel: "telegram", target: "123456789" },
		});
		await scheduler.runJobNow(job.id);

		expect(mockTelegram.send).toHaveBeenCalledWith("telegram:123456789", {
			text: "Mock response from agent",
		});
	});

	test("runJobNow with telegram delivery but no channel configured skips silently", async () => {
		const scheduler = new Scheduler({
			db: db as any,
			runtime: mockRuntime as never,
		});

		const job = await scheduler.createJob({
			name: "TG No Channel",
			schedule: { kind: "every", intervalMs: 60_000 },
			task: "Should not fail",
			delivery: { channel: "telegram", target: "owner" },
		});

		// Should not throw
		const result = await scheduler.runJobNow(job.id);
		expect(result).toBe("Mock response from agent");
	});

	test("setTelegramChannel updates delivery target", async () => {
		const scheduler = new Scheduler({ db: db as any, runtime: mockRuntime as never });
		const mockTelegram = createMockTelegramChannel();

		scheduler.setTelegramChannel(mockTelegram as never, "8669996556");

		const job = await scheduler.createJob({
			name: "Late TG",
			schedule: { kind: "every", intervalMs: 60_000 },
			task: "Late telegram delivery",
			delivery: { channel: "telegram", target: "owner" },
		});
		await scheduler.runJobNow(job.id);

		expect(mockTelegram.send).toHaveBeenCalledWith("telegram:8669996556", {
			text: "Mock response from agent",
		});
	});

	test("at schedule job is marked completed after run", async () => {
		const scheduler = new Scheduler({ db: db as any, runtime: mockRuntime as never });
		const future = new Date(Date.now() + 3_600_000).toISOString();

		const job = await scheduler.createJob({
			name: "One-shot reminder",
			schedule: { kind: "at", at: future },
			task: "Remind me",
		});

		await scheduler.runJobNow(job.id);

		const updated = await scheduler.getJob(job.id);
		expect(updated?.status).toBe("completed");
	});
});
