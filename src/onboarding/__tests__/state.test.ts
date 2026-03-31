import { beforeEach, describe, expect, test } from "bun:test";
import { createMockSupabase } from "../../db/test-helpers.ts";
import { getOnboardingStatus, markOnboardingComplete, markOnboardingStarted } from "../state.ts";

describe("onboarding state", () => {
	let db: ReturnType<typeof createMockSupabase>;

	beforeEach(() => {
		db = createMockSupabase();
	});

	test("getOnboardingStatus returns pending when no records exist", async () => {
		const status = await getOnboardingStatus(db as any);
		expect(status.status).toBe("pending");
		expect(status.started_at).toBeNull();
		expect(status.completed_at).toBeNull();
	});

	test("markOnboardingStarted creates in_progress record", async () => {
		await markOnboardingStarted(db as any);
		const status = await getOnboardingStatus(db as any);
		expect(status.status).toBe("in_progress");
		expect(status.started_at).not.toBeNull();
		expect(status.completed_at).toBeNull();
	});

	test("markOnboardingStarted is idempotent", async () => {
		await markOnboardingStarted(db as any);
		await markOnboardingStarted(db as any);

		// Verify only one record exists by checking the select returns a single in_progress row
		const { data } = await (db as any).from("onboarding_state").select("*");
		expect(data).toHaveLength(1);
	});

	test("markOnboardingComplete transitions in_progress to complete", async () => {
		await markOnboardingStarted(db as any);
		await markOnboardingComplete(db as any);
		const status = await getOnboardingStatus(db as any);
		expect(status.status).toBe("complete");
		expect(status.completed_at).not.toBeNull();
	});

	test("markOnboardingComplete does nothing when not in_progress", async () => {
		await markOnboardingComplete(db as any);
		const status = await getOnboardingStatus(db as any);
		expect(status.status).toBe("pending");
	});

	test("full lifecycle: pending -> in_progress -> complete", async () => {
		expect((await getOnboardingStatus(db as any)).status).toBe("pending");

		await markOnboardingStarted(db as any);
		expect((await getOnboardingStatus(db as any)).status).toBe("in_progress");

		await markOnboardingComplete(db as any);
		expect((await getOnboardingStatus(db as any)).status).toBe("complete");
	});
});
