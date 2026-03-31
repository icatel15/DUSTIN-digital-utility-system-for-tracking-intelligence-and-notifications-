import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createMockSupabase } from "../../db/test-helpers.ts";
import { isFirstRun, isOnboardingInProgress } from "../detection.ts";

describe("isFirstRun", () => {
	const tmpDir = join(import.meta.dir, ".tmp-detection");

	beforeEach(() => {
		mkdirSync(join(tmpDir, "meta"), { recursive: true });
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("returns true when version is 0", () => {
		writeFileSync(
			join(tmpDir, "meta/version.json"),
			JSON.stringify({ version: 0, parent: null, timestamp: "2026-01-01T00:00:00Z", changes: [] }),
		);
		expect(isFirstRun(tmpDir)).toBe(true);
	});

	test("returns false when version is greater than 0", () => {
		writeFileSync(
			join(tmpDir, "meta/version.json"),
			JSON.stringify({ version: 1, parent: 0, timestamp: "2026-01-01T00:00:00Z", changes: [] }),
		);
		expect(isFirstRun(tmpDir)).toBe(false);
	});

	test("returns true when version.json does not exist", () => {
		rmSync(join(tmpDir, "meta/version.json"), { force: true });
		expect(isFirstRun(tmpDir)).toBe(true);
	});

	test("returns true when version.json is malformed", () => {
		writeFileSync(join(tmpDir, "meta/version.json"), "not json");
		expect(isFirstRun(tmpDir)).toBe(true);
	});

	test("returns false for version 5", () => {
		writeFileSync(
			join(tmpDir, "meta/version.json"),
			JSON.stringify({ version: 5, parent: 4, timestamp: "2026-01-01T00:00:00Z", changes: [] }),
		);
		expect(isFirstRun(tmpDir)).toBe(false);
	});
});

describe("isOnboardingInProgress", () => {
	let db: ReturnType<typeof createMockSupabase>;

	beforeEach(() => {
		db = createMockSupabase();
	});

	test("returns false when no onboarding records exist", async () => {
		expect(await isOnboardingInProgress(db as any)).toBe(false);
	});

	test("returns true when status is in_progress", async () => {
		await (db as any).from("onboarding_state").insert({
			status: "in_progress",
			started_at: new Date().toISOString(),
		});
		expect(await isOnboardingInProgress(db as any)).toBe(true);
	});

	test("returns false when status is complete", async () => {
		await (db as any).from("onboarding_state").insert({
			status: "complete",
			started_at: new Date().toISOString(),
			completed_at: new Date().toISOString(),
		});
		expect(await isOnboardingInProgress(db as any)).toBe(false);
	});

	test("returns false when status is pending", async () => {
		await (db as any).from("onboarding_state").insert({
			status: "pending",
		});
		expect(await isOnboardingInProgress(db as any)).toBe(false);
	});
});
