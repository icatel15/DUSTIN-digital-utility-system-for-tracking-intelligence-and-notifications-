import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";

type CheckResult = {
	name: string;
	status: "ok" | "warn" | "fail";
	message: string;
	fix?: string;
};

async function checkBun(): Promise<CheckResult> {
	try {
		const version = Bun.version;
		const major = Number.parseInt(version.split(".")[0], 10);
		if (major < 1) {
			return {
				name: "Bun",
				status: "warn",
				message: `Bun ${version} (recommend 1.x+)`,
				fix: "curl -fsSL https://bun.sh/install | bash",
			};
		}
		return { name: "Bun", status: "ok", message: `v${version}` };
	} catch {
		return { name: "Bun", status: "fail", message: "Not found", fix: "curl -fsSL https://bun.sh/install | bash" };
	}
}

async function checkDocker(): Promise<CheckResult> {
	try {
		const proc = Bun.spawn(["docker", "info"], { stdout: "pipe", stderr: "pipe" });
		const exitCode = await proc.exited;
		if (exitCode !== 0) {
			return { name: "Docker", status: "fail", message: "Not running", fix: "sudo systemctl start docker" };
		}
		return { name: "Docker", status: "ok", message: "Running" };
	} catch {
		return { name: "Docker", status: "fail", message: "Not installed", fix: "https://docs.docker.com/engine/install/" };
	}
}

async function checkQdrant(): Promise<CheckResult> {
	const url = process.env.QDRANT_URL ?? "http://localhost:6333";
	const apiKey = process.env.QDRANT_API_KEY;
	try {
		const headers: Record<string, string> = {};
		if (apiKey) headers["api-key"] = apiKey;
		const resp = await fetch(`${url}/`, { headers, signal: AbortSignal.timeout(5000) });
		if (resp.ok) {
			const isCloud = url.includes("cloud.qdrant.io");
			return { name: "Qdrant", status: "ok", message: `Healthy${isCloud ? " (Cloud)" : ""} at ${url}` };
		}
		return { name: "Qdrant", status: "fail", message: `HTTP ${resp.status} at ${url}`, fix: "Check QDRANT_URL and QDRANT_API_KEY" };
	} catch {
		return {
			name: "Qdrant",
			status: "fail",
			message: `Not reachable at ${url}`,
			fix: "Check QDRANT_URL and QDRANT_API_KEY environment variables",
		};
	}
}

async function checkEmbeddings(): Promise<CheckResult> {
	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) {
		return {
			name: "Embeddings",
			status: "fail",
			message: "OPENAI_API_KEY not set",
			fix: "Set OPENAI_API_KEY environment variable",
		};
	}
	return { name: "Embeddings", status: "ok", message: "OpenAI API key configured" };
}

async function checkConfig(): Promise<CheckResult> {
	if (!existsSync("config/phantom.yaml")) {
		return { name: "Config", status: "fail", message: "config/phantom.yaml not found", fix: "phantom init" };
	}
	try {
		const { loadConfig } = await import("../config/loader.ts");
		const config = loadConfig();
		return { name: "Config", status: "ok", message: `${config.name} (${config.role}, port ${config.port})` };
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { name: "Config", status: "fail", message: msg, fix: "Fix config/phantom.yaml or run phantom init" };
	}
}

async function checkMcpConfig(): Promise<CheckResult> {
	if (!existsSync("config/mcp.yaml")) {
		return {
			name: "MCP Config",
			status: "warn",
			message: "config/mcp.yaml not found (will be auto-generated)",
			fix: "phantom init",
		};
	}
	try {
		const raw = readFileSync("config/mcp.yaml", "utf-8");
		if (raw.includes("placeholder-generate-on-first-run")) {
			return {
				name: "MCP Config",
				status: "warn",
				message: "Contains placeholder tokens",
				fix: "phantom init (or phantom token create)",
			};
		}
		return { name: "MCP Config", status: "ok", message: "Tokens configured" };
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { name: "MCP Config", status: "fail", message: msg };
	}
}

async function checkDatabase(): Promise<CheckResult> {
	const url = process.env.SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_KEY;
	if (!url || !key) {
		return {
			name: "Supabase",
			status: "fail",
			message: "SUPABASE_URL or SUPABASE_SERVICE_KEY not set",
			fix: "Set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables",
		};
	}
	try {
		const { getDatabase } = await import("../db/connection.ts");
		const db = getDatabase();
		const { count, error } = await db.from("sessions").select("*", { count: "exact", head: true });
		if (error) {
			return { name: "Supabase", status: "fail", message: error.message, fix: "Check Supabase connection and run migrations" };
		}
		return { name: "Supabase", status: "ok", message: `Connected (${count ?? 0} sessions)` };
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { name: "Supabase", status: "fail", message: msg, fix: "Check SUPABASE_URL and SUPABASE_SERVICE_KEY" };
	}
}

async function checkEvolvedConfig(): Promise<CheckResult> {
	if (!existsSync("phantom-config")) {
		return { name: "Evolved Config", status: "warn", message: "phantom-config/ not found", fix: "phantom init" };
	}
	const requiredFiles = ["constitution.md", "persona.md", "domain-knowledge.md"];
	const missing = requiredFiles.filter((f) => !existsSync(`phantom-config/${f}`));
	if (missing.length > 0) {
		return { name: "Evolved Config", status: "warn", message: `Missing: ${missing.join(", ")}`, fix: "phantom init" };
	}
	return { name: "Evolved Config", status: "ok", message: "All config files present" };
}

async function checkPhantomHealth(port: number): Promise<CheckResult> {
	try {
		const resp = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(3000) });
		if (!resp.ok) {
			return { name: "Phantom Process", status: "fail", message: `HTTP ${resp.status} on port ${port}` };
		}
		const data = (await resp.json()) as { status: string; agent: string; version: string; uptime: number };
		const uptimeMin = Math.floor(data.uptime / 60);
		return { name: "Phantom Process", status: "ok", message: `${data.agent} v${data.version} (up ${uptimeMin}m)` };
	} catch {
		return { name: "Phantom Process", status: "warn", message: `Not running on port ${port}`, fix: "phantom start" };
	}
}

export async function runDoctor(args: string[]): Promise<void> {
	const { values } = parseArgs({
		args,
		options: {
			help: { type: "boolean", short: "h" },
			json: { type: "boolean" },
			port: { type: "string", short: "p" },
		},
		allowPositionals: false,
	});

	if (values.help) {
		console.log("phantom doctor - Check system health and diagnose issues\n");
		console.log("Usage: phantom doctor [options]\n");
		console.log("Options:");
		console.log("  --json             Output results as JSON");
		console.log("  -p, --port <port>  Port to check for running Phantom (default: 3100)");
		console.log("  -h, --help         Show this help");
		return;
	}

	const port = values.port ? Number.parseInt(values.port, 10) : 3100;

	const checks = await Promise.all([
		checkBun(),
		checkDocker(),
		checkQdrant(),
		checkEmbeddings(),
		checkConfig(),
		checkMcpConfig(),
		checkDatabase(),
		checkEvolvedConfig(),
		checkPhantomHealth(port),
	]);

	if (values.json) {
		console.log(JSON.stringify(checks, null, 2));
		return;
	}

	console.log("Phantom Doctor\n");

	const statusIcon: Record<string, string> = {
		ok: "  OK",
		warn: "WARN",
		fail: "FAIL",
	};

	for (const check of checks) {
		const icon = statusIcon[check.status];
		console.log(`  [${icon}] ${check.name}: ${check.message}`);
		if (check.fix && check.status !== "ok") {
			console.log(`         Fix: ${check.fix}`);
		}
	}

	const failCount = checks.filter((c) => c.status === "fail").length;
	const warnCount = checks.filter((c) => c.status === "warn").length;

	console.log("");
	if (failCount === 0 && warnCount === 0) {
		console.log("All checks passed.");
	} else if (failCount === 0) {
		console.log(`${warnCount} warning(s). Phantom can run but some features may be limited.`);
	} else {
		console.log(`${failCount} failure(s), ${warnCount} warning(s). Fix failures before starting Phantom.`);
	}
}
