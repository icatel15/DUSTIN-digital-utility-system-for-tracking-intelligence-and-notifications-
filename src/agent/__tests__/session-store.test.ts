import { beforeEach, describe, expect, test } from "bun:test";
import { createMockSupabase } from "../../db/test-helpers.ts";
import { SessionStore } from "../session-store.ts";

let db: ReturnType<typeof createMockSupabase>;
let store: SessionStore;

beforeEach(() => {
	db = createMockSupabase();
	store = new SessionStore(db as any);
});

describe("SessionStore", () => {
	test("creates a new session", async () => {
		const session = await store.create("cli", "conv-1");
		expect(session.session_key).toBe("cli:conv-1");
		expect(session.channel_id).toBe("cli");
		expect(session.conversation_id).toBe("conv-1");
		expect(session.status).toBe("active");
	});

	test("finds an active session", async () => {
		await store.create("cli", "conv-1");
		const found = await store.findActive("cli", "conv-1");
		expect(found).not.toBeNull();
		expect(found?.session_key).toBe("cli:conv-1");
	});

	test("returns null for non-existent session", async () => {
		const found = await store.findActive("cli", "missing");
		expect(found).toBeNull();
	});

	test("updates SDK session ID", async () => {
		await store.create("cli", "conv-1");
		await store.updateSdkSessionId("cli:conv-1", "sdk-abc-123");
		const session = await store.getByKey("cli:conv-1");
		expect(session?.sdk_session_id).toBe("sdk-abc-123");
	});

	test("expires a session", async () => {
		await store.create("cli", "conv-1");
		await store.expire("cli:conv-1");
		const found = await store.findActive("cli", "conv-1");
		expect(found).toBeNull();

		const raw = await store.getByKey("cli:conv-1");
		expect(raw?.status).toBe("expired");
	});

	test("touches a session to update last_active_at", async () => {
		await store.create("cli", "conv-1");
		const before = await store.getByKey("cli:conv-1");
		await store.touch("cli:conv-1");
		const after = await store.getByKey("cli:conv-1");
		expect(after?.last_active_at).toBeDefined();
		expect(before?.last_active_at).toBeDefined();
	});

	test("clears SDK session ID", async () => {
		await store.create("cli", "conv-1");
		await store.updateSdkSessionId("cli:conv-1", "sdk-abc-123");
		const check = await store.getByKey("cli:conv-1");
		expect(check?.sdk_session_id).toBe("sdk-abc-123");

		await store.clearSdkSessionId("cli:conv-1");
		const session = await store.getByKey("cli:conv-1");
		expect(session?.sdk_session_id).toBeNull();
		expect(session?.status).toBe("active");
	});

	test("create reactivates an expired session with the same key", async () => {
		await store.create("cli", "conv-1");
		await store.updateSdkSessionId("cli:conv-1", "old-sdk-id");
		await store.expire("cli:conv-1");

		expect(await store.findActive("cli", "conv-1")).toBeNull();

		// Creating again should reactivate, not throw UNIQUE constraint error
		const reactivated = await store.create("cli", "conv-1");
		expect(reactivated.status).toBe("active");
		expect(reactivated.sdk_session_id).toBeNull();
		expect(reactivated.session_key).toBe("cli:conv-1");
	});
});
