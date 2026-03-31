import type { SupabaseClient } from "../db/connection.ts";

export type OnboardingStatus = "pending" | "in_progress" | "complete";

export type OnboardingRecord = {
	status: OnboardingStatus;
	started_at: string | null;
	completed_at: string | null;
};

export async function getOnboardingStatus(db: SupabaseClient): Promise<OnboardingRecord> {
	const { data } = await db
		.from("onboarding_state")
		.select("status, started_at, completed_at")
		.order("id", { ascending: false })
		.limit(1)
		.maybeSingle();

	return data ?? { status: "pending", started_at: null, completed_at: null };
}

export async function markOnboardingStarted(db: SupabaseClient): Promise<void> {
	const existing = await getOnboardingStatus(db);
	if (existing.status === "in_progress") return;

	await db.from("onboarding_state").insert({
		status: "in_progress",
		started_at: new Date().toISOString(),
		completed_at: null,
	});
}

export async function markOnboardingComplete(db: SupabaseClient): Promise<void> {
	await db
		.from("onboarding_state")
		.update({ status: "complete", completed_at: new Date().toISOString() })
		.eq("status", "in_progress");
}
