import type { SupabaseClient } from "../db/connection.ts";

export type MessageRole = "user" | "assistant" | "tool_use";

export type ConversationMessageRow = {
	id: number;
	conversation_id: string;
	session_id: string | null;
	channel_id: string;
	sender_id: string;
	role: MessageRole;
	content: string;
	tool_name: string | null;
	tool_input: Record<string, unknown> | null;
	created_at: string;
};

export type ConversationQueryFilters = {
	conversation_id?: string;
	channel_id?: string;
	session_id?: string;
	role?: MessageRole;
	since?: string;
	until?: string;
	limit?: number;
};

export class ConversationLogger {
	private db: SupabaseClient;

	constructor(db: SupabaseClient) {
		this.db = db;
	}

	async log(entry: {
		conversation_id: string;
		session_id: string | null;
		channel_id: string;
		sender_id: string;
		role: MessageRole;
		content: string;
		tool_name?: string | null;
		tool_input?: Record<string, unknown> | null;
	}): Promise<void> {
		try {
			await this.db.from("conversation_messages").insert({
				conversation_id: entry.conversation_id,
				session_id: entry.session_id,
				channel_id: entry.channel_id,
				sender_id: entry.sender_id,
				role: entry.role,
				content: truncate(entry.content, 4000),
				tool_name: entry.tool_name ?? null,
				tool_input: entry.tool_input ?? null,
			});
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[conversation-audit] Failed to log: ${msg}`);
		}
	}

	async query(filters: ConversationQueryFilters): Promise<ConversationMessageRow[]> {
		let q = this.db
			.from("conversation_messages")
			.select("*")
			.order("id", { ascending: true })
			.limit(filters.limit ?? 50);

		if (filters.conversation_id) q = q.eq("conversation_id", filters.conversation_id);
		if (filters.channel_id) q = q.eq("channel_id", filters.channel_id);
		if (filters.session_id) q = q.eq("session_id", filters.session_id);
		if (filters.role) q = q.eq("role", filters.role);
		if (filters.since) q = q.gte("created_at", filters.since);
		if (filters.until) q = q.lte("created_at", filters.until);

		const { data, error } = await q;
		if (error) {
			const msg = error instanceof Error ? error.message : String(error);
			console.warn(`[conversation-audit] Query failed: ${msg}`);
			return [];
		}
		return (data ?? []) as ConversationMessageRow[];
	}
}

function truncate(str: string, maxLen: number): string {
	if (str.length <= maxLen) return str;
	return `${str.slice(0, maxLen - 3)}...`;
}
