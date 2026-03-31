import { beforeEach, describe, expect, mock, test } from "bun:test";
import { setFeedbackHandler } from "../feedback.ts";
import { type OwnerChecker, registerSlackActions } from "../slack-actions.ts";

type ActionHandler = (args: Record<string, unknown>) => Promise<void>;
const actionHandlers = new Map<string, ActionHandler>();

// Capture feedback signals via setFeedbackHandler instead of mock.module
const feedbackSignals: Array<Record<string, unknown>> = [];

function createMockApp() {
	const mockChatUpdate = mock(() => Promise.resolve({ ok: true }));
	const app = {
		action: (id: string | RegExp, handler: ActionHandler) => {
			const key = id instanceof RegExp ? id.source : id;
			actionHandlers.set(key, handler);
		},
		client: {
			chat: { update: mockChatUpdate },
		},
	};
	return { app, mockChatUpdate };
}

function buildFeedbackBody(userId: string, actionId = "phantom:feedback:positive", value = "") {
	return {
		actions: [{ action_id: actionId, value }],
		channel: { id: "C123" },
		message: { ts: "123.456", text: "test message", blocks: [] },
		user: { id: userId },
	};
}

function buildAgentActionBody(userId: string, actionId = "phantom:action:0", value = "") {
	return {
		actions: [{ action_id: actionId, value }],
		channel: { id: "C123" },
		message: { ts: "123.456", text: "test message", blocks: [] },
		user: { id: userId },
	};
}

async function invokeAction(key: string, body: Record<string, unknown>, client: Record<string, unknown>) {
	const handler = actionHandlers.get(key);
	if (!handler) throw new Error(`No handler registered for action key: ${key}`);
	const mockAck = mock(() => Promise.resolve());
	await handler({ ack: mockAck, body, client });
	return { mockAck };
}

describe("registerSlackActions owner gating", () => {
	beforeEach(() => {
		actionHandlers.clear();
		feedbackSignals.length = 0;
		setFeedbackHandler((signal) => {
			feedbackSignals.push(signal as unknown as Record<string, unknown>);
		});
	});

	describe("non-owner feedback button clicks are dropped", () => {
		test("emitFeedback is NOT called for non-owner feedback click", async () => {
			const ownerChecker: OwnerChecker = (uid) => uid === "UOWNER";
			const { app, mockChatUpdate } = createMockApp();
			registerSlackActions(app as any, ownerChecker);

			const body = buildFeedbackBody("UOTHER", "phantom:feedback:positive");
			await invokeAction("phantom:feedback:positive", body, app.client);

			expect(feedbackSignals).toHaveLength(0);
			expect(mockChatUpdate).not.toHaveBeenCalled();
		});

		test("non-owner negative feedback is also dropped", async () => {
			const ownerChecker: OwnerChecker = (uid) => uid === "UOWNER";
			const { app, mockChatUpdate } = createMockApp();
			registerSlackActions(app as any, ownerChecker);

			const body = buildFeedbackBody("UOTHER", "phantom:feedback:negative");
			await invokeAction("phantom:feedback:negative", body, app.client);

			expect(feedbackSignals).toHaveLength(0);
			expect(mockChatUpdate).not.toHaveBeenCalled();
		});

		test("non-owner partial feedback is also dropped", async () => {
			const ownerChecker: OwnerChecker = (uid) => uid === "UOWNER";
			const { app, mockChatUpdate } = createMockApp();
			registerSlackActions(app as any, ownerChecker);

			const body = buildFeedbackBody("UOTHER", "phantom:feedback:partial");
			await invokeAction("phantom:feedback:partial", body, app.client);

			expect(feedbackSignals).toHaveLength(0);
			expect(mockChatUpdate).not.toHaveBeenCalled();
		});
	});

	describe("non-owner agent action clicks are dropped", () => {
		test("agent action handler returns early for non-owner", async () => {
			const ownerChecker: OwnerChecker = (uid) => uid === "UOWNER";
			const { app, mockChatUpdate } = createMockApp();
			registerSlackActions(app as any, ownerChecker);

			const body = buildAgentActionBody(
				"UOTHER",
				"phantom:action:0",
				JSON.stringify({ label: "Summarize", payload: "do-it" }),
			);
			await invokeAction("^phantom:action:\\d+$", body, app.client);

			expect(mockChatUpdate).not.toHaveBeenCalled();
		});
	});

	describe("owner feedback button clicks are processed normally", () => {
		test("emitFeedback IS called for owner positive feedback", async () => {
			const ownerChecker: OwnerChecker = (uid) => uid === "UOWNER";
			const { app } = createMockApp();
			registerSlackActions(app as any, ownerChecker);

			const body = buildFeedbackBody("UOWNER", "phantom:feedback:positive", "msg123");
			await invokeAction("phantom:feedback:positive", body, app.client);

			expect(feedbackSignals).toHaveLength(1);
			expect(feedbackSignals[0]).toMatchObject({
				type: "positive",
				userId: "UOWNER",
				source: "button",
			});
		});

		test("chat.update IS called for owner feedback (buttons replaced with ack)", async () => {
			const ownerChecker: OwnerChecker = (uid) => uid === "UOWNER";
			const { app, mockChatUpdate } = createMockApp();
			registerSlackActions(app as any, ownerChecker);

			const body = buildFeedbackBody("UOWNER", "phantom:feedback:negative", "msg123");
			await invokeAction("phantom:feedback:negative", body, app.client);

			expect(mockChatUpdate).toHaveBeenCalledTimes(1);
		});
	});

	describe("owner agent action clicks are processed normally", () => {
		test("chat.update IS called for owner agent action", async () => {
			const ownerChecker: OwnerChecker = (uid) => uid === "UOWNER";
			const { app, mockChatUpdate } = createMockApp();
			registerSlackActions(app as any, ownerChecker);

			const body = buildAgentActionBody(
				"UOWNER",
				"phantom:action:0",
				JSON.stringify({ label: "Summarize", payload: "do-it" }),
			);
			await invokeAction("^phantom:action:\\d+$", body, app.client);

			expect(mockChatUpdate).toHaveBeenCalledTimes(1);
		});

		test("action follow-up handler is invoked for owner agent action", async () => {
			const ownerChecker: OwnerChecker = (uid) => uid === "UOWNER";
			const { app } = createMockApp();
			registerSlackActions(app as any, ownerChecker);

			const { setActionFollowUpHandler } = await import("../slack-actions.ts");
			const mockFollowUp = mock(() => Promise.resolve());
			setActionFollowUpHandler(mockFollowUp);

			const body = buildAgentActionBody(
				"UOWNER",
				"phantom:action:0",
				JSON.stringify({ label: "Summarize", payload: "do-it" }),
			);
			await invokeAction("^phantom:action:\\d+$", body, app.client);

			expect(mockFollowUp).toHaveBeenCalledTimes(1);
			const followUpCall = (mockFollowUp.mock.calls as unknown as Array<[Record<string, unknown>]>)[0][0];
			expect(followUpCall).toMatchObject({
				userId: "UOWNER",
				channel: "C123",
				actionLabel: "Summarize",
				actionPayload: "do-it",
			});

			setActionFollowUpHandler(null as any);
		});
	});

	describe("behavior unchanged when no owner checker is configured", () => {
		test("feedback is processed when isOwner is undefined", async () => {
			const { app, mockChatUpdate } = createMockApp();
			registerSlackActions(app as any, undefined);

			const body = buildFeedbackBody("UANYONE", "phantom:feedback:positive", "msg123");
			await invokeAction("phantom:feedback:positive", body, app.client);

			expect(feedbackSignals).toHaveLength(1);
			expect(mockChatUpdate).toHaveBeenCalledTimes(1);
		});

		test("agent actions are processed when isOwner is undefined", async () => {
			const { app, mockChatUpdate } = createMockApp();
			registerSlackActions(app as any, undefined);

			const body = buildAgentActionBody("UANYONE", "phantom:action:0", JSON.stringify({ label: "Do thing" }));
			await invokeAction("^phantom:action:\\d+$", body, app.client);

			expect(mockChatUpdate).toHaveBeenCalledTimes(1);
		});

		test("any user can click feedback when no owner checker", async () => {
			const { app } = createMockApp();
			registerSlackActions(app as any);

			const body = buildFeedbackBody("URANDOM", "phantom:feedback:partial", "msg456");
			await invokeAction("phantom:feedback:partial", body, app.client);

			expect(feedbackSignals).toHaveLength(1);
			expect(feedbackSignals[0]).toMatchObject({
				type: "partial",
				userId: "URANDOM",
			});
		});

		test("any user can click agent actions when no owner checker", async () => {
			const { app, mockChatUpdate } = createMockApp();
			registerSlackActions(app as any);

			const body = buildAgentActionBody("URANDOM", "phantom:action:2", "plain-text-value");
			await invokeAction("^phantom:action:\\d+$", body, app.client);

			expect(mockChatUpdate).toHaveBeenCalledTimes(1);
		});
	});

	describe("edge cases", () => {
		test("handler still acks even when non-owner is gated (feedback)", async () => {
			const ownerChecker: OwnerChecker = (uid) => uid === "UOWNER";
			const { app } = createMockApp();
			registerSlackActions(app as any, ownerChecker);

			const body = buildFeedbackBody("UOTHER");
			const { mockAck } = await invokeAction("phantom:feedback:positive", body, app.client);

			expect(mockAck).toHaveBeenCalledTimes(1);
		});

		test("handler still acks even when non-owner is gated (agent action)", async () => {
			const ownerChecker: OwnerChecker = (uid) => uid === "UOWNER";
			const { app } = createMockApp();
			registerSlackActions(app as any, ownerChecker);

			const body = buildAgentActionBody("UOTHER", "phantom:action:0", "val");
			const { mockAck } = await invokeAction("^phantom:action:\\d+$", body, app.client);

			expect(mockAck).toHaveBeenCalledTimes(1);
		});

		test("registers handlers for all three feedback action IDs", () => {
			const { app } = createMockApp();
			registerSlackActions(app as any);

			expect(actionHandlers.has("phantom:feedback:positive")).toBe(true);
			expect(actionHandlers.has("phantom:feedback:negative")).toBe(true);
			expect(actionHandlers.has("phantom:feedback:partial")).toBe(true);
		});

		test("registers handler for agent action regex pattern", () => {
			const { app } = createMockApp();
			registerSlackActions(app as any);

			expect(actionHandlers.has("^phantom:action:\\d+$")).toBe(true);
		});
	});
});
