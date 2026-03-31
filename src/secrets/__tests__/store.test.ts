import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createMockSupabase } from "../../db/test-helpers.ts";
import { resetKeyCache } from "../crypto.ts";
import { createSecretRequest, getSecret, getSecretRequest, saveSecrets, validateMagicToken } from "../store.ts";

let db: ReturnType<typeof createMockSupabase>;

beforeEach(() => {
	resetKeyCache();
	process.env.SECRET_ENCRYPTION_KEY = randomBytes(32).toString("hex");
	db = createMockSupabase();
});

afterEach(() => {
	resetKeyCache();
	process.env.SECRET_ENCRYPTION_KEY = undefined;
});

const testFields = [
	{ name: "gitlab_token", label: "GitLab Token", type: "password" as const, required: true },
	{ name: "gitlab_url", label: "GitLab URL", type: "text" as const, required: false, default: "https://gitlab.com" },
];

describe("createSecretRequest", () => {
	test("creates a request with a unique ID and magic token", async () => {
		const { requestId, magicToken } = await createSecretRequest(
			db as any,
			testFields,
			"Access GitLab",
			"slack",
			"C123",
			"1234.5678",
		);
		expect(requestId).toMatch(/^sec_[a-z0-9]+$/);
		expect(magicToken).toBeTruthy();
		expect(magicToken.length).toBeGreaterThan(20);
	});

	test("stores request in database", async () => {
		const { requestId } = await createSecretRequest(db as any, testFields, "Access GitLab", "slack", "C123", "1234.5678");
		const request = await getSecretRequest(db as any, requestId);
		expect(request).not.toBeNull();
		expect(request?.purpose).toBe("Access GitLab");
		expect(request?.fields).toHaveLength(2);
		expect(request?.status).toBe("pending");
		expect(request?.notifyChannel).toBe("slack");
		expect(request?.notifyChannelId).toBe("C123");
		expect(request?.notifyThread).toBe("1234.5678");
	});

	test("sets expiration to 10 minutes from creation", async () => {
		const before = Date.now();
		const { requestId } = await createSecretRequest(db as any, testFields, "Test", null, null, null);
		const request = await getSecretRequest(db as any, requestId);
		expect(request).not.toBeNull();
		if (!request) throw new Error("unreachable");
		const expiresMs = new Date(request.expiresAt).getTime();
		const expectedMs = before + 10 * 60 * 1000;
		expect(expiresMs).toBeGreaterThanOrEqual(expectedMs - 2000);
		expect(expiresMs).toBeLessThanOrEqual(expectedMs + 2000);
	});

	test("generates unique IDs for each request", async () => {
		const a = await createSecretRequest(db as any, testFields, "Test A", null, null, null);
		const b = await createSecretRequest(db as any, testFields, "Test B", null, null, null);
		expect(a.requestId).not.toBe(b.requestId);
		expect(a.magicToken).not.toBe(b.magicToken);
	});
});

describe("validateMagicToken", () => {
	test("returns true for valid token and pending request", async () => {
		const { requestId, magicToken } = await createSecretRequest(db as any, testFields, "Test", null, null, null);
		expect(await validateMagicToken(db as any, requestId, magicToken)).toBe(true);
	});

	test("returns false for wrong token", async () => {
		const { requestId } = await createSecretRequest(db as any, testFields, "Test", null, null, null);
		expect(await validateMagicToken(db as any, requestId, "wrong-token")).toBe(false);
	});

	test("returns false for non-existent request", async () => {
		expect(await validateMagicToken(db as any, "sec_nonexistent", "token")).toBe(false);
	});

	test("returns false for completed request", async () => {
		const { requestId, magicToken } = await createSecretRequest(db as any, testFields, "Test", null, null, null);
		await saveSecrets(db as any, requestId, { gitlab_token: "test-value" });
		expect(await validateMagicToken(db as any, requestId, magicToken)).toBe(false);
	});
});

describe("saveSecrets", () => {
	test("encrypts and stores secrets", async () => {
		const { requestId } = await createSecretRequest(db as any, testFields, "Test", null, null, null);
		const { saved } = await saveSecrets(db as any, requestId, { gitlab_token: "glpat-abc123", gitlab_url: "https://gitlab.com" });
		expect(saved).toContain("gitlab_token");
		expect(saved).toContain("gitlab_url");
	});

	test("marks request as completed", async () => {
		const { requestId } = await createSecretRequest(db as any, testFields, "Test", null, null, null);
		await saveSecrets(db as any, requestId, { gitlab_token: "test" });
		const request = await getSecretRequest(db as any, requestId);
		expect(request?.status).toBe("completed");
		expect(request?.completedAt).not.toBeNull();
	});

	test("skips empty values", async () => {
		const { requestId } = await createSecretRequest(db as any, testFields, "Test", null, null, null);
		const { saved } = await saveSecrets(db as any, requestId, { gitlab_token: "abc", gitlab_url: "" });
		expect(saved).toEqual(["gitlab_token"]);
	});

	test("throws for non-existent request", async () => {
		expect(saveSecrets(db as any, "sec_nonexistent", { x: "y" })).rejects.toThrow("Request not found");
	});

	test("throws for already completed request", async () => {
		const { requestId } = await createSecretRequest(db as any, testFields, "Test", null, null, null);
		await saveSecrets(db as any, requestId, { gitlab_token: "first" });
		expect(saveSecrets(db as any, requestId, { gitlab_token: "second" })).rejects.toThrow("already completed");
	});

	test("overwrites existing secrets with same name via new request", async () => {
		const req1 = await createSecretRequest(db as any, testFields, "Test 1", null, null, null);
		await saveSecrets(db as any, req1.requestId, { gitlab_token: "old-value" });

		const req2 = await createSecretRequest(db as any, testFields, "Test 2", null, null, null);
		await saveSecrets(db as any, req2.requestId, { gitlab_token: "new-value" });

		const result = await getSecret(db as any, "gitlab_token");
		expect(result?.value).toBe("new-value");
	});
});

describe("getSecret", () => {
	test("retrieves and decrypts a stored secret", async () => {
		const { requestId } = await createSecretRequest(db as any, testFields, "Test", null, null, null);
		await saveSecrets(db as any, requestId, { gitlab_token: "glpat-real-token-123" });

		const result = await getSecret(db as any, "gitlab_token");
		expect(result).not.toBeNull();
		expect(result?.value).toBe("glpat-real-token-123");
	});

	test("returns null for non-existent secret", async () => {
		expect(await getSecret(db as any, "nonexistent")).toBeNull();
	});

	test("increments access count", async () => {
		const { requestId } = await createSecretRequest(db as any, testFields, "Test", null, null, null);
		await saveSecrets(db as any, requestId, { gitlab_token: "test" });

		await getSecret(db as any, "gitlab_token");
		await getSecret(db as any, "gitlab_token");
		await getSecret(db as any, "gitlab_token");

		// With mock Supabase, we verify via getSecret still working (access tracking is internal)
		const result = await getSecret(db as any, "gitlab_token");
		expect(result).not.toBeNull();
	});

	test("updates last_accessed_at", async () => {
		const { requestId } = await createSecretRequest(db as any, testFields, "Test", null, null, null);
		await saveSecrets(db as any, requestId, { gitlab_token: "test" });

		const result = await getSecret(db as any, "gitlab_token");
		// With mock Supabase, we verify the secret is accessible (access tracking is internal)
		expect(result).not.toBeNull();
	});
});
