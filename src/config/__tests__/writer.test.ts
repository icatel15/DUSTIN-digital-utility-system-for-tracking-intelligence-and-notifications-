import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateConfig } from "../writer.ts";

function createTempDir(): string {
	return mkdtempSync(join(tmpdir(), "writer-test-"));
}

function createTempConfig(dir: string, content: string): string {
	const path = join(dir, "phantom.yaml");
	writeFileSync(path, content);
	return path;
}

const BASE_CONFIG = `name: test-phantom
port: 3100
role: swe
model: claude-haiku-4-5
effort: max
max_budget_usd: 0
timeout_minutes: 240
`;

describe("updateConfig", () => {
	test("updates model in YAML", () => {
		const dir = createTempDir();
		const configPath = createTempConfig(dir, BASE_CONFIG);
		const envPath = join(dir, ".env");
		updateConfig({ model: "claude-sonnet-4-6" }, { configPath, envPath });

		const result = readFileSync(configPath, "utf-8");
		expect(result).toContain("model: claude-sonnet-4-6");
		expect(result).not.toContain("claude-haiku-4-5");
	});

	test("updates effort in YAML", () => {
		const dir = createTempDir();
		const configPath = createTempConfig(dir, BASE_CONFIG);
		const envPath = join(dir, ".env");
		updateConfig({ effort: "high" }, { configPath, envPath });

		const result = readFileSync(configPath, "utf-8");
		expect(result).toContain("effort: high");
	});

	test("updates both model and effort", () => {
		const dir = createTempDir();
		const configPath = createTempConfig(dir, BASE_CONFIG);
		const envPath = join(dir, ".env");
		updateConfig({ model: "claude-opus-4-6", effort: "low" }, { configPath, envPath });

		const result = readFileSync(configPath, "utf-8");
		expect(result).toContain("model: claude-opus-4-6");
		expect(result).toContain("effort: low");
	});

	test("preserves other config values", () => {
		const dir = createTempDir();
		const configPath = createTempConfig(dir, BASE_CONFIG);
		const envPath = join(dir, ".env");
		updateConfig({ model: "claude-sonnet-4-6" }, { configPath, envPath });

		const result = readFileSync(configPath, "utf-8");
		expect(result).toContain("name: test-phantom");
		expect(result).toContain("port: 3100");
		expect(result).toContain("role: swe");
	});

	test("syncs model to .env file", () => {
		const dir = createTempDir();
		const configPath = createTempConfig(dir, BASE_CONFIG);
		const envPath = join(dir, ".env");
		writeFileSync(envPath, "PHANTOM_MODEL=claude-haiku-4-5\n");
		updateConfig({ model: "claude-sonnet-4-6" }, { configPath, envPath });

		const envContent = readFileSync(envPath, "utf-8");
		expect(envContent).toContain("PHANTOM_MODEL=claude-sonnet-4-6");
	});

	test("rejects invalid model (empty string)", () => {
		const dir = createTempDir();
		const configPath = createTempConfig(dir, BASE_CONFIG);
		expect(() => updateConfig({ model: "" }, { configPath })).toThrow("Invalid config");
	});

	test("rejects invalid effort value", () => {
		const dir = createTempDir();
		const configPath = createTempConfig(dir, BASE_CONFIG);
		expect(() => updateConfig({ effort: "turbo" as "max" }, { configPath })).toThrow("Invalid config");
	});

	test("throws on missing config file", () => {
		expect(() => updateConfig({ model: "claude-sonnet-4-6" }, { configPath: "/nonexistent/path.yaml" })).toThrow();
	});
});
