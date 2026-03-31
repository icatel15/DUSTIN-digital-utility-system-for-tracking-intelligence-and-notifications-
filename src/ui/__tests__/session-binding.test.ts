import { createHash } from "node:crypto";
import { afterEach, describe, expect, test } from "bun:test";
import {
	consumeMagicLink,
	createBoundSession,
	createSession,
	getSessionRequestId,
	isValidSession,
	revokeAllSessions,
} from "../session.ts";
import type { SecretField, SecretRequest } from "../../secrets/store.ts";
import { saveSecrets, validateAndConsumeMagicToken } from "../../secrets/store.ts";
import { handleUiRequest, setSecretsDb } from "../serve.ts";

afterEach(() => {
	revokeAllSessions();
});

// ---------------------------------------------------------------------------
// Tests 1-7: Session binding (createBoundSession / getSessionRequestId)
// ---------------------------------------------------------------------------

describe("createBoundSession", () => {
	test("creates a session bound to a requestId", () => {
		const requestId = "sec_abc123";
		const { sessionToken, magicToken } = createBoundSession(requestId);

		expect(sessionToken).toBeTruthy();
		expect(magicToken).toBeTruthy();
		expect(sessionToken).not.toBe(magicToken);
		expect(isValidSession(sessionToken)).toBe(true);
	});

	test("bound session tokens are unique across calls", () => {
		const a = createBoundSession("req_a");
		const b = createBoundSession("req_b");

		expect(a.sessionToken).not.toBe(b.sessionToken);
		expect(a.magicToken).not.toBe(b.magicToken);
	});
});

describe("getSessionRequestId", () => {
	test("returns the bound requestId for a bound session", () => {
		const requestId = "sec_xyz789";
		const { sessionToken } = createBoundSession(requestId);

		expect(getSessionRequestId(sessionToken)).toBe(requestId);
	});

	test("returns null for a generic (unbound) session", () => {
		const { sessionToken } = createSession();

		expect(getSessionRequestId(sessionToken)).toBeNull();
	});

	test("returns null for an unknown token", () => {
		expect(getSessionRequestId("nonexistent-token")).toBeNull();
	});

	test("bound session can only access its own requestId", () => {
		const reqA = "sec_aaa111";
		const reqB = "sec_bbb222";

		const sessionA = createBoundSession(reqA);
		const sessionB = createBoundSession(reqB);

		// Each session returns its own requestId
		expect(getSessionRequestId(sessionA.sessionToken)).toBe(reqA);
		expect(getSessionRequestId(sessionB.sessionToken)).toBe(reqB);

		// They are not equal to each other
		expect(getSessionRequestId(sessionA.sessionToken)).not.toBe(reqB);
		expect(getSessionRequestId(sessionB.sessionToken)).not.toBe(reqA);
	});

	test("session bound to another request returns different requestId", () => {
		const first = createBoundSession("req_first");
		const second = createBoundSession("req_second");

		const firstId = getSessionRequestId(first.sessionToken);
		const secondId = getSessionRequestId(second.sessionToken);

		expect(firstId).not.toBe(secondId);
		expect(firstId).toBe("req_first");
		expect(secondId).toBe("req_second");
	});
});

describe("consumeMagicLink with bound sessions", () => {
	test("magic link for bound session is single-use", () => {
		const { sessionToken, magicToken } = createBoundSession("sec_singleuse");

		const firstUse = consumeMagicLink(magicToken);
		expect(firstUse).toBe(sessionToken);

		const secondUse = consumeMagicLink(magicToken);
		expect(secondUse).toBeNull();
	});

	test("consuming magic link does not affect the bound session validity", () => {
		const requestId = "sec_persist";
		const { sessionToken, magicToken } = createBoundSession(requestId);

		consumeMagicLink(magicToken);

		// Session still valid and still bound after magic link consumed
		expect(isValidSession(sessionToken)).toBe(true);
		expect(getSessionRequestId(sessionToken)).toBe(requestId);
	});
});

describe("isValidSession with bound sessions", () => {
	test("returns true for a valid bound session", () => {
		const { sessionToken } = createBoundSession("sec_valid");
		expect(isValidSession(sessionToken)).toBe(true);
	});

	test("returns false for an unknown token", () => {
		expect(isValidSession("does-not-exist")).toBe(false);
	});

	test("returns false after revokeAllSessions clears bound sessions", () => {
		const { sessionToken } = createBoundSession("sec_revoke");
		expect(isValidSession(sessionToken)).toBe(true);

		revokeAllSessions();
		expect(isValidSession(sessionToken)).toBe(false);
	});

	test("bound and unbound sessions are both valid simultaneously", () => {
		const bound = createBoundSession("sec_mixed");
		const unbound = createSession();

		expect(isValidSession(bound.sessionToken)).toBe(true);
		expect(isValidSession(unbound.sessionToken)).toBe(true);

		expect(getSessionRequestId(bound.sessionToken)).toBe("sec_mixed");
		expect(getSessionRequestId(unbound.sessionToken)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Tests 8-10: saveSecrets field validation (mocked DB)
// ---------------------------------------------------------------------------

function createMockSecretRequest(overrides?: Partial<SecretRequest>): SecretRequest {
	const now = new Date();
	const expires = new Date(now.getTime() + 10 * 60 * 1000);

	return {
		requestId: "sec_mock123",
		fields: [
			{ name: "api_key", label: "API Key", type: "password", required: true },
			{ name: "api_secret", label: "API Secret", type: "password", required: true },
			{ name: "nickname", label: "Nickname", type: "text", required: false },
		],
		purpose: "Test secret request",
		notifyChannel: null,
		notifyChannelId: null,
		notifyThread: null,
		magicTokenHash: "fake-hash",
		status: "pending",
		createdAt: now.toISOString(),
		expiresAt: expires.toISOString(),
		completedAt: null,
		...overrides,
	};
}

/**
 * Build a mock SupabaseClient that returns a predetermined SecretRequest
 * from the "secret_requests" table and accepts upserts to "secrets".
 */
function createMockDb(request: SecretRequest) {
	const secretsUpserted: Array<Record<string, unknown>> = [];

	const mockFrom = (table: string) => {
		if (table === "secret_requests") {
			return {
				select: () => ({
					eq: () => ({
						single: () =>
							Promise.resolve({
								data: {
									request_id: request.requestId,
									fields_json: JSON.stringify(request.fields),
									purpose: request.purpose,
									notify_channel: request.notifyChannel,
									notify_channel_id: request.notifyChannelId,
									notify_thread: request.notifyThread,
									magic_token_hash: request.magicTokenHash,
									status: request.status,
									created_at: request.createdAt,
									expires_at: request.expiresAt,
									completed_at: request.completedAt,
								},
								error: null,
							}),
					}),
				}),
				update: () => ({
					eq: () => Promise.resolve({ error: null }),
				}),
			};
		}
		if (table === "secrets") {
			return {
				upsert: (row: Record<string, unknown>) => {
					secretsUpserted.push(row);
					return {
						onConflict: () => Promise.resolve({ error: null }),
					};
				},
			};
		}
		return {};
	};

	// biome-ignore lint: mock object does not need full type compliance
	const db = { from: mockFrom } as any;
	return { db, secretsUpserted };
}

describe("saveSecrets field validation", () => {
	test("rejects undeclared field names", async () => {
		const request = createMockSecretRequest();
		const { db } = createMockDb(request);

		await expect(
			saveSecrets(db, request.requestId, {
				api_key: "key-value",
				api_secret: "secret-value",
				rogue_field: "should-not-exist",
			}),
		).rejects.toThrow("Undeclared field: rogue_field");
	});

	test("rejects when required fields are missing", async () => {
		const request = createMockSecretRequest();
		const { db } = createMockDb(request);

		// Only providing the optional field, missing both required fields
		await expect(
			saveSecrets(db, request.requestId, {
				nickname: "dustin",
			}),
		).rejects.toThrow("Missing required fields: api_key, api_secret");
	});

	test("rejects when a required field is empty string", async () => {
		const request = createMockSecretRequest();
		const { db } = createMockDb(request);

		await expect(
			saveSecrets(db, request.requestId, {
				api_key: "",
				api_secret: "valid-secret",
				nickname: "dustin",
			}),
		).rejects.toThrow("Missing required fields: api_key");
	});

	test("rejects when a required field is whitespace-only", async () => {
		const request = createMockSecretRequest();
		const { db } = createMockDb(request);

		await expect(
			saveSecrets(db, request.requestId, {
				api_key: "   ",
				api_secret: "valid-secret",
			}),
		).rejects.toThrow("Missing required fields: api_key");
	});

	test("rejects empty submission (all values blank) with 'No secrets were provided'", async () => {
		const request = createMockSecretRequest({
			fields: [
				{ name: "optional_a", label: "Optional A", type: "text", required: false },
				{ name: "optional_b", label: "Optional B", type: "text", required: false },
			],
		});
		const { db } = createMockDb(request);

		await expect(
			saveSecrets(db, request.requestId, {
				optional_a: "",
				optional_b: "   ",
			}),
		).rejects.toThrow("No secrets were provided");
	});

	test("rejects when request is already completed", async () => {
		const request = createMockSecretRequest({ status: "completed" });
		const { db } = createMockDb(request);

		await expect(
			saveSecrets(db, request.requestId, {
				api_key: "key",
				api_secret: "secret",
			}),
		).rejects.toThrow("Request already completed");
	});

	test("rejects when request is expired", async () => {
		const pastDate = new Date(Date.now() - 60 * 1000).toISOString();
		const request = createMockSecretRequest({ expiresAt: pastDate });
		const { db } = createMockDb(request);

		await expect(
			saveSecrets(db, request.requestId, {
				api_key: "key",
				api_secret: "secret",
			}),
		).rejects.toThrow("Request expired");
	});
});

// ---------------------------------------------------------------------------
// HTTP-level tests: exercise the actual guards in serve.ts
// ---------------------------------------------------------------------------

function mockSecretsDb(request: SecretRequest) {
	const mockFrom = (table: string) => {
		if (table === "secret_requests") {
			return {
				select: () => ({
					eq: () => ({
						single: () =>
							Promise.resolve({
								data: {
									request_id: request.requestId,
									fields_json: JSON.stringify(request.fields),
									purpose: request.purpose,
									notify_channel: request.notifyChannel,
									notify_channel_id: request.notifyChannelId,
									notify_thread: request.notifyThread,
									magic_token_hash: request.magicTokenHash,
									status: request.status,
									created_at: request.createdAt,
									expires_at: request.expiresAt,
									completed_at: request.completedAt,
								},
								error: null,
							}),
					}),
				}),
				update: () => ({
					eq: () => ({
						eq: () => ({
							eq: () => ({
								gte: () => ({
									select: () => Promise.resolve({ data: [], error: null }),
								}),
							}),
						}),
					}),
				}),
			};
		}
		if (table === "secrets") {
			return {
				upsert: () => ({
					onConflict: () => Promise.resolve({ error: null }),
				}),
			};
		}
		return {};
	};

	// biome-ignore lint: mock object
	const db = { from: mockFrom } as any;
	setSecretsDb(db);
	return db;
}

function httpReq(path: string, opts?: RequestInit & { cookie?: string }): Request {
	const headers: Record<string, string> = {};
	if (opts?.cookie) headers.Cookie = opts.cookie;
	return new Request(`http://localhost:3100${path}`, {
		...opts,
		headers: { ...headers, ...((opts?.headers as Record<string, string>) ?? {}) },
	});
}

describe("HTTP-level secret binding guards (serve.ts)", () => {
	test("generic UI session is rejected from viewing secret form (403)", async () => {
		const request = createMockSecretRequest();
		mockSecretsDb(request);

		// Create a generic (unbound) session
		const { sessionToken } = createSession();

		const res = await handleUiRequest(
			httpReq(`/ui/secrets/${request.requestId}`, {
				cookie: `phantom_session=${sessionToken}`,
			}),
		);

		// Generic session must NOT see the form
		expect(res.status).toBe(403);
	});

	test("bound session for correct requestId can view form (200)", async () => {
		const request = createMockSecretRequest();
		mockSecretsDb(request);

		const { sessionToken } = createBoundSession(request.requestId);

		const res = await handleUiRequest(
			httpReq(`/ui/secrets/${request.requestId}`, {
				cookie: `phantom_session=${sessionToken}`,
			}),
		);

		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain("API Key");
	});

	test("bound session for different requestId is rejected from viewing form (403)", async () => {
		const request = createMockSecretRequest();
		mockSecretsDb(request);

		const { sessionToken } = createBoundSession("sec_other_request");

		const res = await handleUiRequest(
			httpReq(`/ui/secrets/${request.requestId}`, {
				cookie: `phantom_session=${sessionToken}`,
			}),
		);

		expect(res.status).toBe(403);
	});

	test("generic UI session is rejected from saving secrets (403)", async () => {
		const request = createMockSecretRequest();
		mockSecretsDb(request);

		const { sessionToken } = createSession();

		const res = await handleUiRequest(
			httpReq(`/ui/api/secrets/${request.requestId}`, {
				method: "POST",
				cookie: `phantom_session=${sessionToken}`,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ secrets: { api_key: "val", api_secret: "val" } }),
			}),
		);

		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body.error).toContain("not bound");
	});

	test("bound session for different requestId is rejected from saving (403)", async () => {
		const request = createMockSecretRequest();
		mockSecretsDb(request);

		const { sessionToken } = createBoundSession("sec_wrong_id");

		const res = await handleUiRequest(
			httpReq(`/ui/api/secrets/${request.requestId}`, {
				method: "POST",
				cookie: `phantom_session=${sessionToken}`,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ secrets: { api_key: "val", api_secret: "val" } }),
			}),
		);

		expect(res.status).toBe(403);
	});

	test("unauthenticated request to save secrets returns 401", async () => {
		const res = await handleUiRequest(
			httpReq("/ui/api/secrets/sec_mock123", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ secrets: { api_key: "val" } }),
			}),
		);

		expect(res.status).toBe(401);
	});
});

// ---------------------------------------------------------------------------
// Magic-link ?magic= exchange + replay tests (HTTP-level)
// ---------------------------------------------------------------------------

function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

/**
 * Mock DB that supports the full magic-link exchange flow:
 * - getSecretRequest (SELECT) always returns the request
 * - validateAndConsumeMagicToken (UPDATE CAS) succeeds once, then fails
 */
function mockSecretsDbWithMagicLink(request: SecretRequest, magicToken: string) {
	const tokenHash = hashToken(magicToken);
	let consumed = false;

	const mockFrom = (table: string) => {
		if (table === "secret_requests") {
			return {
				select: () => ({
					eq: () => ({
						single: () =>
							Promise.resolve({
								data: {
									request_id: request.requestId,
									fields_json: JSON.stringify(request.fields),
									purpose: request.purpose,
									notify_channel: request.notifyChannel,
									notify_channel_id: request.notifyChannelId,
									notify_thread: request.notifyThread,
									magic_token_hash: tokenHash,
									magic_token_used: consumed,
									status: request.status,
									created_at: request.createdAt,
									expires_at: request.expiresAt,
									completed_at: request.completedAt,
								},
								error: null,
							}),
					}),
				}),
				// CAS UPDATE chain: .update().eq().eq().eq().eq().gte().select()
				update: () => ({
					eq: (_col: string, _val: unknown) => ({
						eq: (_col2: string, expectedHash: string) => ({
							eq: (_col3: string, _unusedVal: boolean) => ({
								eq: (_col4: string, _statusVal: string) => ({
									gte: () => ({
										select: () => {
											// CAS: succeed only if not yet consumed and hash matches
											if (!consumed && expectedHash === tokenHash) {
												consumed = true;
												return Promise.resolve({
													data: [{ request_id: request.requestId }],
													error: null,
												});
											}
											return Promise.resolve({ data: [], error: null });
										},
									}),
								}),
							}),
						}),
					}),
				}),
			};
		}
		return {};
	};

	// biome-ignore lint: mock object
	const db = { from: mockFrom } as any;
	setSecretsDb(db);
	return { db, isConsumed: () => consumed };
}

describe("magic-link ?magic= exchange + replay (HTTP-level)", () => {
	test("first valid magic-link request returns 200 and sets a bound cookie", async () => {
		const magicToken = "test-magic-token-abc123";
		const request = createMockSecretRequest({ requestId: "sec_magic01" });
		mockSecretsDbWithMagicLink(request, magicToken);

		const res = await handleUiRequest(
			httpReq(`/ui/secrets/sec_magic01?magic=${magicToken}`),
		);

		expect(res.status).toBe(200);
		const cookie = res.headers.get("Set-Cookie");
		expect(cookie).toContain("phantom_session=");
		expect(cookie).toContain("HttpOnly");

		// The response should contain the form
		const body = await res.text();
		expect(body).toContain("API Key");

		// Extract session token from cookie and verify it's bound
		const match = cookie?.match(/phantom_session=([^;]+)/);
		expect(match).not.toBeNull();
		const sessionToken = match![1];
		expect(getSessionRequestId(decodeURIComponent(sessionToken))).toBe("sec_magic01");
	});

	test("second reuse of the same magic link fails (no cookie set)", async () => {
		const magicToken = "test-magic-token-replay";
		const request = createMockSecretRequest({ requestId: "sec_replay01" });
		const { isConsumed } = mockSecretsDbWithMagicLink(request, magicToken);

		// First request — succeeds
		const res1 = await handleUiRequest(
			httpReq(`/ui/secrets/sec_replay01?magic=${magicToken}`),
		);
		expect(res1.status).toBe(200);
		expect(res1.headers.get("Set-Cookie")).toContain("phantom_session=");
		expect(isConsumed()).toBe(true);

		// Second request — same token, already consumed
		const res2 = await handleUiRequest(
			httpReq(`/ui/secrets/sec_replay01?magic=${magicToken}`),
		);
		// Should fail — no cookie, shows expired/unauthorized page
		expect(res2.headers.get("Set-Cookie")).toBeNull();
		expect(res2.status).toBe(401);
	});
});

// ---------------------------------------------------------------------------
// Direct unit test of validateAndConsumeMagicToken (CAS)
// ---------------------------------------------------------------------------

describe("validateAndConsumeMagicToken (atomic CAS)", () => {
	test("returns true on first call and false on second (single-use)", async () => {
		const magicToken = "cas-test-token";
		const requestId = "sec_cas01";
		const request = createMockSecretRequest({ requestId });
		const { db } = mockSecretsDbWithMagicLink(request, magicToken);

		const first = await validateAndConsumeMagicToken(db, requestId, magicToken);
		expect(first).toBe(true);

		const second = await validateAndConsumeMagicToken(db, requestId, magicToken);
		expect(second).toBe(false);
	});

	test("returns false for wrong magic token", async () => {
		const magicToken = "correct-token";
		const requestId = "sec_cas02";
		const request = createMockSecretRequest({ requestId });
		const { db } = mockSecretsDbWithMagicLink(request, magicToken);

		const result = await validateAndConsumeMagicToken(db, requestId, "wrong-token");
		expect(result).toBe(false);
	});
});
