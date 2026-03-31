import type { SupabaseClient } from "../db/connection.ts";
import type { AuditEntry } from "./types.ts";

export class AuditLogger {
	private db: SupabaseClient;

	constructor(db: SupabaseClient) {
		this.db = db;
	}

	async log(entry: Omit<AuditEntry, "id" | "timestamp">): Promise<void> {
		try {
			await this.db.from("mcp_audit").insert({
				client_name: entry.client_name,
				method: entry.method,
				tool_name: entry.tool_name,
				resource_uri: entry.resource_uri,
				input_summary: entry.input_summary ? truncate(entry.input_summary, 500) : null,
				output_summary: entry.output_summary ? truncate(entry.output_summary, 500) : null,
				cost_usd: entry.cost_usd,
				duration_ms: entry.duration_ms,
				status: entry.status,
			});
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[mcp-audit] Failed to log: ${msg}`);
		}
	}

	async getRecent(limit = 50): Promise<AuditEntry[]> {
		const { data } = await this.db
			.from("mcp_audit")
			.select("*")
			.order("id", { ascending: false })
			.limit(limit);

		return (data ?? []) as AuditEntry[];
	}

	async getByClient(clientName: string, limit = 50): Promise<AuditEntry[]> {
		const { data } = await this.db
			.from("mcp_audit")
			.select("*")
			.eq("client_name", clientName)
			.order("id", { ascending: false })
			.limit(limit);

		return (data ?? []) as AuditEntry[];
	}
}

function truncate(str: string, maxLen: number): string {
	if (str.length <= maxLen) return str;
	return `${str.slice(0, maxLen - 3)}...`;
}
