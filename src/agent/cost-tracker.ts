import type { SupabaseClient } from "../db/connection.ts";
import type { AgentCost } from "./events.ts";

export class CostTracker {
	private db: SupabaseClient;

	constructor(db: SupabaseClient) {
		this.db = db;
	}

	async record(sessionKey: string, cost: AgentCost, model: string): Promise<void> {
		await this.db.from("cost_events").insert({
			session_key: sessionKey,
			cost_usd: cost.totalUsd,
			input_tokens: cost.inputTokens,
			output_tokens: cost.outputTokens,
			model,
		});

		// Supabase doesn't support `SET col = col + ?` directly,
		// so read-then-update to increment counters.
		const { data: session } = await this.db
			.from("sessions")
			.select("total_cost_usd, input_tokens, output_tokens, turn_count")
			.eq("session_key", sessionKey)
			.single();

		if (session) {
			const now = new Date().toISOString();
			await this.db
				.from("sessions")
				.update({
					total_cost_usd: session.total_cost_usd + cost.totalUsd,
					input_tokens: session.input_tokens + cost.inputTokens,
					output_tokens: session.output_tokens + cost.outputTokens,
					turn_count: session.turn_count + 1,
					last_active_at: now,
				})
				.eq("session_key", sessionKey);
		}
	}

	async getSessionCost(sessionKey: string): Promise<number> {
		const { data: row } = await this.db
			.from("sessions")
			.select("total_cost_usd")
			.eq("session_key", sessionKey)
			.maybeSingle();
		return row?.total_cost_usd ?? 0;
	}

	async getCostEvents(sessionKey: string): Promise<CostEvent[]> {
		const { data } = await this.db
			.from("cost_events")
			.select("*")
			.eq("session_key", sessionKey)
			.order("created_at", { ascending: false });
		return (data ?? []) as CostEvent[];
	}
}

export type CostEvent = {
	id: number;
	session_key: string;
	cost_usd: number;
	input_tokens: number;
	output_tokens: number;
	model: string;
	created_at: string;
};
