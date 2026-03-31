import { beforeAll, describe, expect, test } from "bun:test";
import { createMockSupabase } from "../../db/test-helpers.ts";
import { ConversationLogger } from "../conversation-logger.ts";

describe("ConversationLogger", () => {
	let db: ReturnType<typeof createMockSupabase>;
	let logger: ConversationLogger;

	beforeAll(() => {
		db = createMockSupabase();
		logger = new ConversationLogger(db as any);
	});

	test("logs a user message", async () => {
		await logger.log({
			conversation_id: "telegram:12345",
			session_id: null,
			channel_id: "telegram",
			sender_id: "user-1",
			role: "user",
			content: "Hello Phantom",
		});

		const rows = await logger.query({ conversation_id: "telegram:12345" });
		expect(rows.length).toBe(1);
		expect(rows[0].role).toBe("user");
		expect(rows[0].content).toBe("Hello Phantom");
		expect(rows[0].sender_id).toBe("user-1");
		expect(rows[0].session_id).toBeNull();
		expect(rows[0].tool_name).toBeNull();
		expect(rows[0].tool_input).toBeNull();
	});

	test("logs an assistant message with session_id", async () => {
		await logger.log({
			conversation_id: "telegram:12345",
			session_id: "sdk-session-abc",
			channel_id: "telegram",
			sender_id: "phantom",
			role: "assistant",
			content: "Hi there! How can I help?",
		});

		const rows = await logger.query({ role: "assistant" });
		expect(rows.length).toBe(1);
		expect(rows[0].session_id).toBe("sdk-session-abc");
		expect(rows[0].content).toBe("Hi there! How can I help?");
	});

	test("logs a tool_use with tool_name and tool_input", async () => {
		const toolInput = { query: "SELECT 1", database: "main" };
		await logger.log({
			conversation_id: "telegram:12345",
			session_id: "sdk-session-abc",
			channel_id: "telegram",
			sender_id: "phantom",
			role: "tool_use",
			content: "Bash",
			tool_name: "Bash",
			tool_input: toolInput,
		});

		const rows = await logger.query({ role: "tool_use" });
		expect(rows.length).toBe(1);
		expect(rows[0].tool_name).toBe("Bash");
		expect(rows[0].tool_input).toEqual(toolInput);
		expect(rows[0].content).toBe("Bash");
	});

	test("truncates content longer than 4000 chars", async () => {
		const longContent = "x".repeat(5000);
		await logger.log({
			conversation_id: "truncate-test",
			session_id: null,
			channel_id: "cli",
			sender_id: "user-1",
			role: "user",
			content: longContent,
		});

		const rows = await logger.query({ conversation_id: "truncate-test" });
		expect(rows[0].content.length).toBeLessThanOrEqual(4000);
		expect(rows[0].content.endsWith("...")).toBe(true);
	});

	test("does not throw when insert fails", async () => {
		// Create a logger with a broken db
		const brokenDb = {
			from: () => ({
				insert: () => {
					throw new Error("Connection refused");
				},
			}),
		};
		const brokenLogger = new ConversationLogger(brokenDb as any);

		// Should not throw
		await brokenLogger.log({
			conversation_id: "broken",
			session_id: null,
			channel_id: "cli",
			sender_id: "user-1",
			role: "user",
			content: "This should not throw",
		});
	});

	test("query filters by channel_id", async () => {
		// Insert a message on a different channel
		await logger.log({
			conversation_id: "slack:C01ABC:123",
			session_id: null,
			channel_id: "slack",
			sender_id: "user-2",
			role: "user",
			content: "Slack message",
		});

		const slackRows = await logger.query({ channel_id: "slack" });
		expect(slackRows.length).toBe(1);
		expect(slackRows[0].content).toBe("Slack message");
	});

	test("query filters by date range", async () => {
		const allRows = await logger.query({});
		expect(allRows.length).toBeGreaterThan(0);

		// Filter with a future date should return nothing new
		const futureRows = await logger.query({ since: "2099-01-01T00:00:00Z" });
		expect(futureRows.length).toBe(0);
	});

	test("query respects limit", async () => {
		const rows = await logger.query({ limit: 2 });
		expect(rows.length).toBeLessThanOrEqual(2);
	});

	test("query returns empty array when no matches", async () => {
		const rows = await logger.query({ conversation_id: "nonexistent" });
		expect(rows).toEqual([]);
	});

	test("query returns results in ascending id order", async () => {
		const rows = await logger.query({ conversation_id: "telegram:12345" });
		for (let i = 1; i < rows.length; i++) {
			expect(rows[i].id).toBeGreaterThan(rows[i - 1].id);
		}
	});
});
