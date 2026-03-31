import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { SupabaseClient } from "../db/connection.ts";
import { decryptSecret, encryptSecret } from "./crypto.ts";

export type SecretField = {
	name: string;
	label: string;
	description?: string;
	type: "password" | "text";
	required: boolean;
	placeholder?: string;
	default?: string;
};

export type SecretRequest = {
	requestId: string;
	fields: SecretField[];
	purpose: string;
	notifyChannel: string | null;
	notifyChannelId: string | null;
	notifyThread: string | null;
	magicTokenHash: string;
	status: "pending" | "completed" | "expired";
	createdAt: string;
	expiresAt: string;
	completedAt: string | null;
};

type SecretRequestRow = {
	request_id: string;
	fields_json: string;
	purpose: string;
	notify_channel: string | null;
	notify_channel_id: string | null;
	notify_thread: string | null;
	magic_token_hash: string;
	status: string;
	created_at: string;
	expires_at: string;
	completed_at: string | null;
};

type SecretRow = {
	name: string;
	encrypted_value: string;
	iv: string;
	auth_tag: string;
	field_type: string;
	created_at: string;
	updated_at: string;
	last_accessed_at: string | null;
	access_count: number;
};

const MAGIC_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

export async function createSecretRequest(
	db: SupabaseClient,
	fields: SecretField[],
	purpose: string,
	notifyChannel: string | null,
	notifyChannelId: string | null,
	notifyThread: string | null,
): Promise<{ requestId: string; magicToken: string }> {
	const requestId = `sec_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
	const magicToken = randomBytes(24).toString("base64url");
	const magicTokenHash = hashToken(magicToken);
	const now = new Date();
	const expiresAt = new Date(now.getTime() + MAGIC_TOKEN_TTL_MS);

	const { error } = await db.from("secret_requests").insert({
		request_id: requestId,
		fields_json: JSON.stringify(fields),
		purpose,
		notify_channel: notifyChannel,
		notify_channel_id: notifyChannelId,
		notify_thread: notifyThread,
		magic_token_hash: magicTokenHash,
		status: "pending",
		created_at: now.toISOString(),
		expires_at: expiresAt.toISOString(),
	});

	if (error) throw new Error(`Failed to create secret request: ${error.message}`);

	return { requestId, magicToken };
}

export async function getSecretRequest(db: SupabaseClient, requestId: string): Promise<SecretRequest | null> {
	const { data, error } = await db.from("secret_requests").select("*").eq("request_id", requestId).single();

	if (error || !data) return null;
	return rowToRequest(data as SecretRequestRow);
}

export async function validateMagicToken(db: SupabaseClient, requestId: string, magicToken: string): Promise<boolean> {
	const { data, error } = await db
		.from("secret_requests")
		.select("magic_token_hash, status, expires_at")
		.eq("request_id", requestId)
		.single();

	if (error || !data) return false;
	if (data.status !== "pending") return false;
	if (new Date(data.expires_at) < new Date()) return false;

	return data.magic_token_hash === hashToken(magicToken);
}

export async function saveSecrets(
	db: SupabaseClient,
	requestId: string,
	secrets: Record<string, string>,
): Promise<{ saved: string[] }> {
	const request = await getSecretRequest(db, requestId);
	if (!request) throw new Error("Request not found");
	if (request.status !== "pending") throw new Error("Request already completed");
	if (new Date(request.expiresAt) < new Date()) throw new Error("Request expired");

	const saved: string[] = [];
	const fieldMap = new Map(request.fields.map((f) => [f.name, f]));
	const now = new Date().toISOString();

	for (const [name, value] of Object.entries(secrets)) {
		if (!value.trim()) continue;

		const field = fieldMap.get(name);
		const fieldType = field?.type ?? "password";
		const { encrypted, iv, authTag } = encryptSecret(value);

		const { error } = await db.from("secrets").upsert(
			{
				name,
				encrypted_value: encrypted,
				iv,
				auth_tag: authTag,
				field_type: fieldType,
				created_at: now,
				updated_at: now,
			},
			{ onConflict: "name" },
		);

		if (error) throw new Error(`Failed to save secret '${name}': ${error.message}`);

		saved.push(name);
		console.log(`[secrets] Stored secret: ${name}`);
	}

	// Mark request as completed
	const { error: updateError } = await db
		.from("secret_requests")
		.update({ status: "completed", completed_at: now })
		.eq("request_id", requestId);

	if (updateError) throw new Error(`Failed to mark request completed: ${updateError.message}`);

	return { saved };
}

function rowToRequest(row: SecretRequestRow): SecretRequest {
	return {
		requestId: row.request_id,
		fields: JSON.parse(row.fields_json) as SecretField[],
		purpose: row.purpose,
		notifyChannel: row.notify_channel,
		notifyChannelId: row.notify_channel_id,
		notifyThread: row.notify_thread,
		magicTokenHash: row.magic_token_hash,
		status: row.status as SecretRequest["status"],
		createdAt: row.created_at,
		expiresAt: row.expires_at,
		completedAt: row.completed_at,
	};
}

export async function getSecret(db: SupabaseClient, name: string): Promise<{ value: string; storedAt: string } | null> {
	const { data, error } = await db.from("secrets").select("*").eq("name", name).single();

	if (error || !data) return null;
	const row = data as SecretRow;

	// Update access audit
	await db
		.from("secrets")
		.update({
			last_accessed_at: new Date().toISOString(),
			access_count: (row.access_count ?? 0) + 1,
		})
		.eq("name", name);

	const value = decryptSecret(row.encrypted_value, row.iv, row.auth_tag);
	console.log(`[secrets] Retrieved secret: ${name}`);
	return { value, storedAt: row.created_at };
}
