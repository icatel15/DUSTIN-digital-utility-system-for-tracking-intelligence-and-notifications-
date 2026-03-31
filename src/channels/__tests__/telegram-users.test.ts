import { afterEach, describe, expect, test } from "bun:test";
import { createMockSupabase } from "../../db/test-helpers.ts";
import { clearUserCache, determineChatContext, ensureUser, getUserRole, isAuthorizedUser } from "../telegram-users.ts";

describe("isAuthorizedUser", () => {
	test("allows any user when no IDs configured", () => {
		expect(isAuthorizedUser("12345", undefined, undefined)).toBe(true);
	});

	test("allows owner", () => {
		expect(isAuthorizedUser("111", "111", "222")).toBe(true);
	});

	test("allows partner", () => {
		expect(isAuthorizedUser("222", "111", "222")).toBe(true);
	});

	test("rejects unauthorized user", () => {
		expect(isAuthorizedUser("999", "111", "222")).toBe(false);
	});

	test("allows owner when only owner configured", () => {
		expect(isAuthorizedUser("111", "111", undefined)).toBe(true);
	});

	test("rejects non-owner when only owner configured", () => {
		expect(isAuthorizedUser("999", "111", undefined)).toBe(false);
	});
});

describe("determineChatContext", () => {
	test("group chat returns group", () => {
		expect(determineChatContext("group", "111", "111", "222")).toBe("group");
	});

	test("supergroup returns group", () => {
		expect(determineChatContext("supergroup", "111", "111", "222")).toBe("group");
	});

	test("private chat from owner returns dm_owner", () => {
		expect(determineChatContext("private", "111", "111", "222")).toBe("dm_owner");
	});

	test("private chat from partner returns dm_partner", () => {
		expect(determineChatContext("private", "222", "111", "222")).toBe("dm_partner");
	});
});

describe("getUserRole", () => {
	test("returns owner for owner ID", () => {
		expect(getUserRole("111", "111")).toBe("owner");
	});

	test("returns partner for non-owner ID", () => {
		expect(getUserRole("222", "111")).toBe("partner");
	});
});

describe("ensureUser", () => {
	afterEach(() => {
		clearUserCache();
	});

	test("creates user on first call", async () => {
		const db = createMockSupabase() as any;
		const user = await ensureUser(db, "111", "Alice", "owner");
		expect(user.telegramUserId).toBe("111");
		expect(user.role).toBe("owner");
	});

	test("returns cached user on second call", async () => {
		const db = createMockSupabase() as any;
		const first = await ensureUser(db, "111", "Alice", "owner");
		const second = await ensureUser(db, "111", "Alice", "owner");
		expect(first.id).toBe(second.id);
	});

	test("creates different records for different users", async () => {
		const db = createMockSupabase() as any;
		const owner = await ensureUser(db, "111", "Alice", "owner");
		clearUserCache(); // clear cache so partner lookup hits DB
		const partner = await ensureUser(db, "222", "Bob", "partner");
		expect(owner.role).toBe("owner");
		expect(partner.role).toBe("partner");
		expect(owner.telegramUserId).not.toBe(partner.telegramUserId);
	});
});
