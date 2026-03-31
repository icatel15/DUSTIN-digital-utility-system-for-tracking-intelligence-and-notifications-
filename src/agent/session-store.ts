import type { SupabaseClient } from "../db/connection.ts";

export type Session = {
	id: number;
	session_key: string;
	sdk_session_id: string | null;
	channel_id: string;
	conversation_id: string;
	status: string;
	total_cost_usd: number;
	input_tokens: number;
	output_tokens: number;
	turn_count: number;
	created_at: string;
	last_active_at: string;
};

const STALE_HOURS = 24;

export class SessionStore {
	private db: SupabaseClient;

	constructor(db: SupabaseClient) {
		this.db = db;
	}

	async create(channelId: string, conversationId: string): Promise<Session> {
		const sessionKey = `${channelId}:${conversationId}`;
		const now = new Date().toISOString();

		// Upsert: if an expired row with this key exists, reactivate it
		// instead of failing on the UNIQUE constraint.
		await this.db.from("sessions").upsert(
			{
				session_key: sessionKey,
				channel_id: channelId,
				conversation_id: conversationId,
				status: "active",
				sdk_session_id: null,
				total_cost_usd: 0,
				input_tokens: 0,
				output_tokens: 0,
				turn_count: 0,
				last_active_at: now,
				created_at: now,
			},
			{ onConflict: "session_key" },
		);

		return (await this.getByKey(sessionKey)) as Session;
	}

	async getByKey(sessionKey: string): Promise<Session | null> {
		const { data } = await this.db.from("sessions").select("*").eq("session_key", sessionKey).maybeSingle();
		return data as Session | null;
	}

	async findActive(channelId: string, conversationId: string): Promise<Session | null> {
		const sessionKey = `${channelId}:${conversationId}`;
		const session = await this.getByKey(sessionKey);

		if (!session) return null;
		if (session.status !== "active") return null;

		if (this.isStale(session)) {
			await this.expire(sessionKey);
			return null;
		}

		return session;
	}

	async updateSdkSessionId(sessionKey: string, sdkSessionId: string): Promise<void> {
		const now = new Date().toISOString();
		await this.db
			.from("sessions")
			.update({ sdk_session_id: sdkSessionId, last_active_at: now })
			.eq("session_key", sessionKey);
	}

	async clearSdkSessionId(sessionKey: string): Promise<void> {
		const now = new Date().toISOString();
		await this.db.from("sessions").update({ sdk_session_id: null, last_active_at: now }).eq("session_key", sessionKey);
	}

	async touch(sessionKey: string): Promise<void> {
		const now = new Date().toISOString();
		await this.db.from("sessions").update({ last_active_at: now }).eq("session_key", sessionKey);
	}

	async expire(sessionKey: string): Promise<void> {
		await this.db.from("sessions").update({ status: "expired" }).eq("session_key", sessionKey);
	}

	private isStale(session: Session): boolean {
		const lastActive = new Date(session.last_active_at).getTime();
		const now = Date.now();
		const hoursElapsed = (now - lastActive) / (1000 * 60 * 60);
		return hoursElapsed > STALE_HOURS;
	}
}
