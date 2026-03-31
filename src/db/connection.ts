import { type SupabaseClient, createClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function getDatabase(): SupabaseClient {
	if (client) return client;

	const url = process.env.SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_KEY;

	if (!url || !key) {
		throw new Error(
			"SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required. " +
				"Set them in .env or your environment.",
		);
	}

	client = createClient(url, key, {
		auth: { autoRefreshToken: false, persistSession: false },
	});

	return client;
}

export function closeDatabase(): void {
	client = null;
}

/**
 * Create a mock Supabase client for testing.
 * Tests should mock individual table operations as needed.
 */
export function createTestDatabase(): SupabaseClient {
	const url = process.env.SUPABASE_URL ?? "http://localhost:54321";
	const key = process.env.SUPABASE_SERVICE_KEY ?? "test-service-key";
	return createClient(url, key, {
		auth: { autoRefreshToken: false, persistSession: false },
	});
}

export type { SupabaseClient };
