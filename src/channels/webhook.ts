/**
 * Generic webhook channel with HMAC-SHA256 signature verification.
 * Supports synchronous (inline) and asynchronous (callback URL) response modes.
 * Compatible with Zapier, Make, n8n, and custom integrations.
 */

import { randomUUID, timingSafeEqual } from "node:crypto";
import { isSafeCallbackUrlAsync } from "../utils/url-validator.ts";
import type { Channel, ChannelCapabilities, InboundMessage, OutboundMessage, SentMessage } from "./types.ts";

export type WebhookChannelConfig = {
	secret: string;
	/** Max time in ms to wait for agent response in sync mode. Default 25000 (25s). */
	syncTimeoutMs?: number;
};

export type WebhookPayload = {
	message: string;
	conversation_id: string;
	user_id?: string;
	thread_id?: string;
	metadata?: Record<string, unknown>;
	callback_url?: string;
	/** @deprecated Use X-Webhook-Timestamp header instead. */
	timestamp?: number;
	/** @deprecated Use X-Webhook-Signature header instead. */
	signature?: string;
};

export type WebhookResponse = {
	status: "ok" | "accepted" | "error";
	response?: string;
	task_id?: string;
	message?: string;
	metadata?: {
		session_id?: string;
		cost_usd?: number;
		duration_ms?: number;
	};
};

type PendingResponse = {
	resolve: (text: string) => void;
	timer: ReturnType<typeof setTimeout>;
	taskId: string;
	conversationId: string;
};

type CallbackEntry = {
	url: string;
	conversationId: string;
};

export class WebhookChannel implements Channel {
	readonly id = "webhook";
	readonly name = "Webhook";
	readonly capabilities: ChannelCapabilities = {
		threads: false,
		richText: false,
		attachments: false,
		buttons: false,
	};

	private config: WebhookChannelConfig;
	private messageHandler: ((message: InboundMessage) => Promise<void>) | null = null;
	private connected = false;
	// Track pending sync responses: taskId -> resolver
	private pendingResponses = new Map<string, PendingResponse>();
	// Track async callback URLs: taskId -> { url, conversationId }
	private callbackUrls = new Map<string, CallbackEntry>();
	// Reverse index: conversationId -> Set<taskId> (for routing responses from send())
	private conversationTasks = new Map<string, Set<string>>();

	constructor(config: WebhookChannelConfig) {
		this.config = config;
	}

	async connect(): Promise<void> {
		this.connected = true;
		console.log("[webhook] Channel ready");
	}

	async disconnect(): Promise<void> {
		// Clean up pending responses
		for (const [, pending] of this.pendingResponses) {
			clearTimeout(pending.timer);
			pending.resolve("");
		}
		this.pendingResponses.clear();
		this.callbackUrls.clear();
		this.conversationTasks.clear();
		this.connected = false;
		console.log("[webhook] Disconnected");
	}

	async send(conversationId: string, message: OutboundMessage): Promise<SentMessage> {
		const taskIds = this.conversationTasks.get(conversationId);
		if (taskIds && taskIds.size > 0) {
			// Take the first (oldest) task for this conversation
			const taskId = taskIds.values().next().value as string;
			taskIds.delete(taskId);
			if (taskIds.size === 0) this.conversationTasks.delete(conversationId);

			// Resolve sync pending response
			const pending = this.pendingResponses.get(taskId);
			if (pending) {
				clearTimeout(pending.timer);
				pending.resolve(message.text);
				this.pendingResponses.delete(taskId);
			}

			// Send async callback
			const callback = this.callbackUrls.get(taskId);
			if (callback) {
				await this.sendCallback(callback.url, callback.conversationId, message.text);
				this.callbackUrls.delete(taskId);
			}
		}

		return {
			id: randomUUID(),
			channelId: this.id,
			conversationId,
			timestamp: new Date(),
		};
	}

	onMessage(handler: (message: InboundMessage) => Promise<void>): void {
		this.messageHandler = handler;
	}

	isConnected(): boolean {
		return this.connected;
	}

	/**
	 * Handle an incoming webhook request.
	 * Called from the HTTP server's /webhook route.
	 */
	async handleRequest(req: Request): Promise<Response> {
		if (req.method !== "POST") {
			return Response.json({ status: "error", message: "Method not allowed" }, { status: 405 });
		}

		let body: string;
		let payload: WebhookPayload;

		try {
			body = await req.text();
			payload = JSON.parse(body) as WebhookPayload;
		} catch {
			return Response.json({ status: "error", message: "Invalid JSON" }, { status: 400 });
		}

		// Validate required payload fields
		if (!payload.message || !payload.conversation_id) {
			return Response.json(
				{ status: "error", message: "Missing required fields: message, conversation_id" },
				{ status: 400 },
			);
		}

		// Read auth from headers (preferred) or fall back to body fields (deprecated)
		let signature = req.headers.get("X-Webhook-Signature");
		let timestampStr = req.headers.get("X-Webhook-Timestamp");

		if (!signature && payload.signature) {
			console.warn(
				"[webhook] DEPRECATED: body-based auth — migrate to X-Webhook-Signature and X-Webhook-Timestamp headers",
			);
			signature = payload.signature;
			timestampStr = payload.timestamp != null ? String(payload.timestamp) : null;
		}

		if (!signature || !timestampStr) {
			return Response.json(
				{
					status: "error",
					message: "Missing authentication: X-Webhook-Signature and X-Webhook-Timestamp headers required",
				},
				{ status: 401 },
			);
		}

		const timestamp = Number(timestampStr);
		if (Number.isNaN(timestamp)) {
			return Response.json({ status: "error", message: "Invalid timestamp" }, { status: 400 });
		}

		// Verify signature
		if (!this.verifySignature(body, timestampStr, signature)) {
			return Response.json({ status: "error", message: "Invalid signature" }, { status: 401 });
		}

		// Verify timestamp freshness (5 minute window)
		const now = Date.now();
		const age = Math.abs(now - timestamp);
		if (age > 5 * 60 * 1000) {
			return Response.json({ status: "error", message: "Timestamp too old" }, { status: 401 });
		}

		if (!this.messageHandler) {
			return Response.json({ status: "error", message: "No message handler configured" }, { status: 503 });
		}

		const conversationId = `webhook:${payload.conversation_id}`;
		const taskId = randomUUID();

		const inbound: InboundMessage = {
			id: taskId,
			channelId: this.id,
			conversationId,
			senderId: payload.user_id ?? "webhook",
			text: payload.message,
			timestamp: new Date(timestamp),
			metadata: payload.metadata,
		};

		// Register in the reverse index
		const tasks = this.conversationTasks.get(conversationId) ?? new Set<string>();
		tasks.add(taskId);
		this.conversationTasks.set(conversationId, tasks);

		// Async mode: return immediately, send response to callback URL
		if (payload.callback_url) {
			const validation = await isSafeCallbackUrlAsync(payload.callback_url);
			if (!validation.safe) {
				// Clean up reverse index on early exit
				tasks.delete(taskId);
				if (tasks.size === 0) this.conversationTasks.delete(conversationId);
				return Response.json(
					{ status: "error", message: `Invalid callback URL: ${validation.reason}` },
					{ status: 400 },
				);
			}

			this.callbackUrls.set(taskId, { url: payload.callback_url, conversationId });

			// Fire and forget
			void this.messageHandler(inbound).catch((err: unknown) => {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`[webhook] Error handling async message: ${msg}`);
			});

			return Response.json({ status: "accepted", task_id: taskId } satisfies WebhookResponse);
		}

		// Sync mode: wait for the response
		const timeoutMs = this.config.syncTimeoutMs ?? 25_000;
		const responseText = await this.waitForResponse(conversationId, taskId, inbound, timeoutMs);

		if (responseText === null) {
			return Response.json({ status: "error", message: "Response timeout" } satisfies WebhookResponse, { status: 504 });
		}

		return Response.json({
			status: "ok",
			response: responseText,
		} satisfies WebhookResponse);
	}

	private async waitForResponse(
		conversationId: string,
		taskId: string,
		inbound: InboundMessage,
		timeoutMs: number,
	): Promise<string | null> {
		return new Promise<string | null>((resolve) => {
			const timer = setTimeout(() => {
				this.pendingResponses.delete(taskId);
				const tasks = this.conversationTasks.get(conversationId);
				if (tasks) {
					tasks.delete(taskId);
					if (tasks.size === 0) this.conversationTasks.delete(conversationId);
				}
				resolve(null);
			}, timeoutMs);

			this.pendingResponses.set(taskId, {
				resolve: (text: string) => resolve(text),
				timer,
				taskId,
				conversationId,
			});

			// Process the message (will call send() which resolves the promise)
			void this.messageHandler?.(inbound).catch((err: unknown) => {
				clearTimeout(timer);
				this.pendingResponses.delete(taskId);
				const tasks = this.conversationTasks.get(conversationId);
				if (tasks) {
					tasks.delete(taskId);
					if (tasks.size === 0) this.conversationTasks.delete(conversationId);
				}
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`[webhook] Error handling sync message: ${msg}`);
				resolve(null);
			});
		});
	}

	private async sendCallback(url: string, conversationId: string, text: string): Promise<void> {
		// Defense-in-depth: re-validate URL at fetch time (DNS may have changed)
		const recheck = await isSafeCallbackUrlAsync(url);
		if (!recheck.safe) {
			console.error(`[webhook] Callback URL failed re-validation: ${url} (${recheck.reason})`);
			return;
		}

		try {
			const response = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				redirect: "manual",
				body: JSON.stringify({
					conversation_id: conversationId.replace("webhook:", ""),
					status: "complete",
					response: text,
				}),
			});

			// Treat redirect responses as failure
			if (response.status >= 300 && response.status < 400) {
				console.error(`[webhook] Callback returned redirect (${response.status}), treating as failure: ${url}`);
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[webhook] Failed to send callback to ${url}: ${msg}`);
		}
	}

	private verifySignature(body: string, timestamp: string, signature: string): boolean {
		const payload = `${timestamp}.${body}`;
		const hmac = new Bun.CryptoHasher("sha256", this.config.secret);
		hmac.update(payload);
		const expected = hmac.digest("hex");

		try {
			return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
		} catch {
			return false;
		}
	}
}
