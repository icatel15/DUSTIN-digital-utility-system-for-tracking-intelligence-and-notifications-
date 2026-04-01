import { readFileSync, writeFileSync } from "node:fs";
import { parse, stringify } from "yaml";
import { PhantomConfigSchema } from "./schemas.ts";

const DEFAULT_CONFIG_PATH = "config/phantom.yaml";
const ENV_PATH = ".env";

export type ConfigUpdates = {
	model?: string;
	effort?: "low" | "medium" | "high" | "max";
};

export type UpdateConfigOptions = {
	configPath?: string;
	envPath?: string;
};

export function updateConfig(updates: ConfigUpdates, options?: UpdateConfigOptions): void {
	const path = options?.configPath ?? DEFAULT_CONFIG_PATH;
	const envPath = options?.envPath ?? ENV_PATH;

	const text = readFileSync(path, "utf-8");
	const current = parse(text) as Record<string, unknown>;

	const merged = { ...current, ...updates };

	const result = PhantomConfigSchema.safeParse(merged);
	if (!result.success) {
		const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
		throw new Error(`Invalid config: ${issues}`);
	}

	writeFileSync(path, stringify(merged));

	if (updates.model) {
		updateEnvVar("PHANTOM_MODEL", updates.model, envPath);
	}
	if (updates.effort) {
		updateEnvVar("PHANTOM_EFFORT", updates.effort, envPath);
	}

	console.log(`[config] Updated: ${JSON.stringify(updates)}`);
}

function updateEnvVar(key: string, value: string, envPath?: string): void {
	const targetPath = envPath ?? ENV_PATH;
	try {
		let content = readFileSync(targetPath, "utf-8");
		const regex = new RegExp(`^${key}=.*$`, "m");
		if (regex.test(content)) {
			content = content.replace(regex, `${key}=${value}`);
		} else {
			content = `${content.trimEnd()}\n${key}=${value}\n`;
		}
		writeFileSync(targetPath, content);
	} catch {
		// .env may not exist locally — that's acceptable
	}
}
