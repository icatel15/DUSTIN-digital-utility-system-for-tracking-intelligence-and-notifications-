import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "../db/connection.ts";

/**
 * True when phantom-config/meta/version.json shows generation 0.
 * This means the agent has never completed onboarding.
 */
export function isFirstRun(configDir: string): boolean {
	try {
		const raw = readFileSync(join(configDir, "meta/version.json"), "utf-8");
		const version = JSON.parse(raw) as { version: number };
		return version.version === 0;
	} catch {
		// No version file at all means first run
		return true;
	}
}

/**
 * True when onboarding was started but not completed (survives restarts).
 */
export async function isOnboardingInProgress(db: SupabaseClient): Promise<boolean> {
	const { data } = await db
		.from("onboarding_state")
		.select("status")
		.order("id", { ascending: false })
		.limit(1)
		.maybeSingle();

	return data?.status === "in_progress";
}
