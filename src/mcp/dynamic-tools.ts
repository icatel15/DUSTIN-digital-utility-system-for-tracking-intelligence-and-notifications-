import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { SupabaseClient } from "../db/connection.ts";
import { executeDynamicHandler } from "./dynamic-handlers.ts";

export type DynamicToolRow = {
	name: string;
	description: string;
	input_schema: string;
	handler_type: "script" | "shell";
	handler_code: string | null;
	handler_path: string | null;
	registered_at: string;
	registered_by: string | null;
};

export type DynamicToolDef = {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	handlerType: "script" | "shell";
	handlerCode?: string;
	handlerPath?: string;
	registeredBy?: string;
};

const ToolNameSchema = z
	.string()
	.min(1)
	.max(100)
	.regex(/^[a-z][a-z0-9_]*$/, "Tool name must be lowercase alphanumeric with underscores, starting with a letter");

const RegisterToolInputSchema = z.object({
	name: ToolNameSchema,
	description: z.string().min(1).max(1000),
	input_schema: z.record(z.unknown()).default({}),
	handler_type: z.enum(["script", "shell"]).default("shell"),
	handler_code: z.string().optional(),
	handler_path: z.string().optional(),
});

export class DynamicToolRegistry {
	private db: SupabaseClient;
	private tools: Map<string, DynamicToolDef> = new Map();

	constructor(db: SupabaseClient) {
		this.db = db;
	}

	async loadFromDatabase(): Promise<void> {
		const { data, error } = await this.db.from("dynamic_tools").select("*");

		if (error) {
			console.warn(`[dynamic-tools] Failed to load tools from database: ${error.message}`);
			return;
		}

		const rows = (data ?? []) as DynamicToolRow[];
		for (const row of rows) {
			try {
				const def: DynamicToolDef = {
					name: row.name,
					description: row.description,
					inputSchema: JSON.parse(row.input_schema),
					handlerType: row.handler_type,
					handlerCode: row.handler_code ?? undefined,
					handlerPath: row.handler_path ?? undefined,
					registeredBy: row.registered_by ?? undefined,
				};
				this.tools.set(row.name, def);
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				console.warn(`[dynamic-tools] Failed to load tool '${row.name}': ${msg}`);
			}
		}

		if (this.tools.size > 0) {
			console.log(`[dynamic-tools] Loaded ${this.tools.size} dynamic tool(s) from database`);
		}
	}

	async register(input: z.infer<typeof RegisterToolInputSchema>): Promise<DynamicToolDef> {
		const parsed = RegisterToolInputSchema.parse(input);

		if (parsed.handler_type === "script" && !parsed.handler_path) {
			throw new Error("handler_path is required for script handler type");
		}
		if (parsed.handler_type === "shell" && !parsed.handler_code) {
			throw new Error("handler_code is required for shell handler type");
		}

		const def: DynamicToolDef = {
			name: parsed.name,
			description: parsed.description,
			inputSchema: parsed.input_schema,
			handlerType: parsed.handler_type,
			handlerCode: parsed.handler_code,
			handlerPath: parsed.handler_path,
		};

		const { error } = await this.db.from("dynamic_tools").upsert(
			{
				name: def.name,
				description: def.description,
				input_schema: JSON.stringify(def.inputSchema),
				handler_type: def.handlerType,
				handler_code: def.handlerCode ?? null,
				handler_path: def.handlerPath ?? null,
			},
			{ onConflict: "name" },
		);

		if (error) throw new Error(`Failed to register tool '${def.name}': ${error.message}`);

		this.tools.set(def.name, def);
		console.log(`[dynamic-tools] Registered tool: ${def.name}`);
		return def;
	}

	async unregister(name: string): Promise<boolean> {
		if (!this.tools.has(name)) return false;

		const { error } = await this.db.from("dynamic_tools").delete().eq("name", name);
		if (error) throw new Error(`Failed to unregister tool '${name}': ${error.message}`);

		this.tools.delete(name);
		console.log(`[dynamic-tools] Unregistered tool: ${name}`);
		return true;
	}

	getAll(): DynamicToolDef[] {
		return Array.from(this.tools.values());
	}

	get(name: string): DynamicToolDef | undefined {
		return this.tools.get(name);
	}

	has(name: string): boolean {
		return this.tools.has(name);
	}

	count(): number {
		return this.tools.size;
	}

	registerAllOnServer(server: McpServer): void {
		for (const tool of this.tools.values()) {
			registerDynamicToolOnServer(server, tool);
		}
	}
}

export function registerDynamicToolOnServer(server: McpServer, tool: DynamicToolDef): void {
	const zodSchema = buildZodSchema(tool.inputSchema);

	server.registerTool(
		tool.name,
		{ description: tool.description, inputSchema: zodSchema },
		async (input): Promise<CallToolResult> => executeDynamicHandler(tool, input),
	);
}

function buildZodSchema(schema: Record<string, unknown>): z.ZodObject<Record<string, z.ZodTypeAny>> {
	const shape: Record<string, z.ZodTypeAny> = {};

	for (const [key, value] of Object.entries(schema)) {
		const typeName = typeof value === "string" ? value : String(value);
		switch (typeName) {
			case "string":
				shape[key] = z.string().optional();
				break;
			case "number":
				shape[key] = z.number().optional();
				break;
			case "boolean":
				shape[key] = z.boolean().optional();
				break;
			default:
				shape[key] = z.unknown().optional();
				break;
		}
	}

	return z.object(shape);
}

export { RegisterToolInputSchema };
