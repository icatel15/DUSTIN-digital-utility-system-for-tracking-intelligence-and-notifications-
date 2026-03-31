import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

type ValidationResult = { safe: boolean; reason?: string };

// Explicit metadata IP blocklist
const BLOCKED_METADATA_IPS = new Set([
	"169.254.169.254", // AWS/GCP
	"100.100.100.200", // Alibaba
	"fd00:ec2::254", // AWS IPv6
]);

// Blocked cloud metadata hostnames
const BLOCKED_METADATA_HOSTNAMES = new Set([
	"metadata.google.internal",
	"metadata.google.com",
	"metadata.azure.com",
	"metadata.azure.internal",
]);

/**
 * Validate that a URL is safe for server-side requests (SSRF prevention).
 * Blocks private IPs, localhost, cloud metadata endpoints, and link-local addresses.
 * Synchronous version: checks literal hostname only (no DNS resolution).
 */
export function isSafeCallbackUrl(url: string): ValidationResult {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return { safe: false, reason: "Invalid URL" };
	}

	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
		return { safe: false, reason: `Unsupported protocol: ${parsed.protocol}` };
	}

	const hostname = parsed.hostname.toLowerCase();

	// Block localhost variants
	if (
		hostname === "localhost" ||
		hostname === "127.0.0.1" ||
		hostname === "::1" ||
		hostname === "0.0.0.0" ||
		hostname === "[::1]"
	) {
		return { safe: false, reason: "Localhost addresses are not allowed" };
	}

	// Block well-known cloud metadata endpoints by hostname
	if (BLOCKED_METADATA_HOSTNAMES.has(hostname)) {
		return { safe: false, reason: "Cloud metadata endpoints are not allowed" };
	}

	// Block explicit metadata IPs
	if (BLOCKED_METADATA_IPS.has(hostname)) {
		return { safe: false, reason: "Cloud metadata IP addresses are not allowed" };
	}

	// Check if hostname is an IP address and block private ranges
	const ipVersion = isIP(hostname);
	if (ipVersion > 0) {
		if (isPrivateIp(hostname)) {
			return { safe: false, reason: "Private IP addresses are not allowed" };
		}
	}

	return { safe: true };
}

/**
 * Async SSRF validation with DNS resolution.
 * Resolves the hostname and checks all returned IPs against the blocklist.
 */
export async function isSafeCallbackUrlAsync(url: string): Promise<ValidationResult> {
	// First run the sync checks
	const syncResult = isSafeCallbackUrl(url);
	if (!syncResult.safe) return syncResult;

	const parsed = new URL(url);
	const hostname = parsed.hostname.toLowerCase();

	// If hostname is already an IP, sync check is sufficient
	if (isIP(hostname) > 0) return syncResult;

	// Resolve DNS and check all returned addresses
	try {
		const results = await lookup(hostname, { all: true, verbatim: true });

		for (const result of results) {
			const addr = result.address;

			if (BLOCKED_METADATA_IPS.has(addr)) {
				return { safe: false, reason: `Hostname resolves to blocked metadata IP: ${addr}` };
			}

			if (isPrivateIp(addr)) {
				return { safe: false, reason: `Hostname resolves to private IP: ${addr}` };
			}
		}
	} catch {
		return { safe: false, reason: "DNS resolution failed" };
	}

	return { safe: true };
}

export function isPrivateIp(ip: string): boolean {
	const lower = ip.toLowerCase();

	// Handle IPv4-mapped IPv6 (::ffff:10.0.0.1)
	if (lower.startsWith("::ffff:")) {
		const embedded = lower.slice(7);
		// Only recurse if the embedded part looks like IPv4
		if (isIP(embedded) === 4) {
			return isPrivateIp(embedded);
		}
	}

	const parts = ip.split(".").map(Number);
	if (parts.length === 4 && parts.every((p) => !Number.isNaN(p))) {
		// 10.0.0.0/8
		if (parts[0] === 10) return true;
		// 172.16.0.0/12
		if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
		// 192.168.0.0/16
		if (parts[0] === 192 && parts[1] === 168) return true;
		// 127.0.0.0/8 (loopback)
		if (parts[0] === 127) return true;
		// 169.254.0.0/16 (link-local, including cloud metadata)
		if (parts[0] === 169 && parts[1] === 254) return true;
		// 0.0.0.0/8
		if (parts[0] === 0) return true;
	}

	// IPv6 private ranges
	if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // Unique local (includes fd00:ec2::254)
	if (lower.startsWith("fe80")) return true; // Link-local
	if (lower === "::1") return true; // Loopback

	return false;
}
