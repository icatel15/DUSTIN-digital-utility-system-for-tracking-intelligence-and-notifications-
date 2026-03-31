import { describe, expect, test } from "bun:test";
import { runMigrations } from "../migrate.ts";
import { createMockSupabase } from "../test-helpers.ts";

describe("runMigrations", () => {
	test("does not throw when given a valid Supabase client", async () => {
		const db = createMockSupabase();

		// Pre-seed the sessions table so the connectivity check succeeds
		await (db as any).from("sessions").insert({ id: 1 });

		await expect(runMigrations(db as any)).resolves.toBeUndefined();
	});

	test("is idempotent - running twice does not fail", async () => {
		const db = createMockSupabase();

		// Pre-seed the sessions table so the connectivity check succeeds
		await (db as any).from("sessions").insert({ id: 1 });

		await runMigrations(db as any);
		await runMigrations(db as any);
		// No error means success
	});
});
