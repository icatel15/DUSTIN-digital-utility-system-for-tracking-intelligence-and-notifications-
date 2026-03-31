import type { SupabaseClient } from "../db/connection.ts";

export type ChatContext = "group" | "dm_owner" | "dm_partner";
export type UserRole = "owner" | "partner";

type CachedUser = {
	id: string;
	telegramUserId: string;
	role: UserRole;
};

const userCache = new Map<string, CachedUser>();

/**
 * Ensure a user record exists in Supabase for the given Telegram user.
 * Creates on first message, returns cached result after that.
 */
export async function ensureUser(
	db: SupabaseClient,
	telegramUserId: string,
	displayName: string | undefined,
	role: UserRole,
): Promise<CachedUser> {
	const cached = userCache.get(telegramUserId);
	if (cached) return cached;

	const { data: existing } = await db
		.from("users")
		.select("id, telegram_user_id, role")
		.eq("telegram_user_id", telegramUserId)
		.maybeSingle();

	if (existing) {
		const user: CachedUser = {
			id: existing.id,
			telegramUserId: existing.telegram_user_id,
			role: existing.role,
		};
		userCache.set(telegramUserId, user);
		return user;
	}

	const { error: insertError } = await db
		.from("users")
		.insert({
			telegram_user_id: telegramUserId,
			display_name: displayName ?? null,
			role,
		});

	if (insertError) {
		throw new Error(`Failed to create user for Telegram ID ${telegramUserId}: ${insertError.message}`);
	}

	// Read back the created user
	const { data: created } = await db
		.from("users")
		.select("id, telegram_user_id, role")
		.eq("telegram_user_id", telegramUserId)
		.single();

	if (!created) {
		throw new Error(`Failed to read back user for Telegram ID ${telegramUserId}`);
	}

	const user: CachedUser = {
		id: created.id,
		telegramUserId: created.telegram_user_id,
		role: created.role,
	};
	userCache.set(telegramUserId, user);
	console.log(`[telegram] Registered user: ${displayName ?? telegramUserId} (${role})`);
	return user;
}

/**
 * Determine the chat context from Telegram message metadata.
 */
export function determineChatContext(
	chatType: string,
	senderId: string,
	ownerUserId: string | undefined,
	partnerUserId: string | undefined,
): ChatContext {
	if (chatType === "group" || chatType === "supergroup") {
		return "group";
	}
	if (senderId === ownerUserId) {
		return "dm_owner";
	}
	if (senderId === partnerUserId) {
		return "dm_partner";
	}
	return "dm_owner"; // fallback for when IDs aren't configured
}

/**
 * Check if a Telegram user ID is authorized to interact with the bot.
 * If no user IDs are configured, all users are allowed (development mode).
 */
export function isAuthorizedUser(
	senderId: string,
	ownerUserId: string | undefined,
	partnerUserId: string | undefined,
): boolean {
	if (!ownerUserId && !partnerUserId) return true;
	return senderId === ownerUserId || senderId === partnerUserId;
}

/**
 * Get the role for an authorized Telegram user.
 */
export function getUserRole(
	senderId: string,
	ownerUserId: string | undefined,
): UserRole {
	return senderId === ownerUserId ? "owner" : "partner";
}

/** Clear user cache (for testing). */
export function clearUserCache(): void {
	userCache.clear();
}
