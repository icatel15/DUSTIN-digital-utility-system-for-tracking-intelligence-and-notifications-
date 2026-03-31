import type { SupabaseClient } from "./connection.ts";

/**
 * Verify Supabase connectivity and that required tables exist.
 * Actual migrations are applied via Supabase CLI (supabase db push)
 * or the Supabase dashboard before the application starts.
 *
 * Migration files live in supabase/migrations/*.sql.
 */
export async function runMigrations(db: SupabaseClient): Promise<void> {
	// Verify connectivity by querying a known table
	const { error } = await db.from("sessions").select("id").limit(0);
	if (error) {
		throw new Error(
			`Supabase connectivity check failed: ${error.message}. ` +
				"Ensure SUPABASE_URL and SUPABASE_SERVICE_KEY are correct and migrations have been applied.",
		);
	}
}
