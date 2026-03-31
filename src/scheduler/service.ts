import { randomUUID } from "node:crypto";
import type { AgentRuntime } from "../agent/runtime.ts";
import type { SlackChannel } from "../channels/slack.ts";
import type { SupabaseClient } from "../db/connection.ts";
import { computeBackoffNextRun, computeNextRunAt, parseScheduleValue, serializeScheduleValue } from "./schedule.ts";
import type { JobCreateInput, JobRow, ScheduledJob } from "./types.ts";

const MAX_TIMER_MS = 60_000;
const MAX_CONSECUTIVE_ERRORS = 10;
const STARTUP_STAGGER_MS = 5_000;

type SchedulerDeps = {
	db: SupabaseClient;
	runtime: AgentRuntime;
	slackChannel?: SlackChannel;
	ownerUserId?: string;
	deliveryAllowlist?: Set<string>;
};

export class Scheduler {
	private db: SupabaseClient;
	private runtime: AgentRuntime;
	private slackChannel: SlackChannel | undefined;
	private ownerUserId: string | undefined;
	private deliveryAllowlist: Set<string> | undefined;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private running = false;
	private executing = false;

	constructor(deps: SchedulerDeps) {
		this.db = deps.db;
		this.runtime = deps.runtime;
		this.slackChannel = deps.slackChannel;
		this.ownerUserId = deps.ownerUserId;
		this.deliveryAllowlist = deps.deliveryAllowlist;
	}

	/** Set Slack channel after construction (for lazy wiring when channels init after scheduler) */
	setSlackChannel(channel: SlackChannel, ownerUserId?: string): void {
		this.slackChannel = channel;
		if (ownerUserId) this.ownerUserId = ownerUserId;
	}

	async start(): Promise<void> {
		if (this.running) return;
		this.running = true;

		await this.recoverMissedJobs();
		await this.armTimer();
		console.log("[scheduler] Started");
	}

	stop(): void {
		this.running = false;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		console.log("[scheduler] Stopped");
	}

	isRunning(): boolean {
		return this.running;
	}

	async createJob(input: JobCreateInput): Promise<ScheduledJob> {
		const id = randomUUID();
		const scheduleValue = serializeScheduleValue(input.schedule);
		const nextRun = computeNextRunAt(input.schedule);
		const delivery = input.delivery ?? { channel: "slack", target: "owner" };

		// Validate delivery target against allowlist at creation time
		if (delivery.target !== "owner" && this.deliveryAllowlist && !this.deliveryAllowlist.has(delivery.target)) {
			throw new Error(`Delivery target '${delivery.target}' is not in the allowed delivery targets`);
		}

		const now = new Date().toISOString();
		await this.db.from("scheduled_jobs").insert({
			id,
			name: input.name,
			description: input.description ?? null,
			enabled: true,
			schedule_kind: input.schedule.kind,
			schedule_value: scheduleValue,
			task: input.task,
			delivery_channel: delivery.channel,
			delivery_target: delivery.target,
			status: "active",
			next_run_at: nextRun?.toISOString() ?? null,
			run_count: 0,
			consecutive_errors: 0,
			last_run_at: null,
			last_run_status: null,
			last_run_duration_ms: null,
			last_run_error: null,
			delete_after_run: input.deleteAfterRun ?? false,
			created_by: input.createdBy ?? "agent",
			created_at: now,
			updated_at: now,
		});

		await this.armTimer();

		const created = await this.getJob(id);
		if (!created) throw new Error(`Failed to create job: ${id}`);
		return created;
	}

	async deleteJob(id: string): Promise<boolean> {
		const { data } = await this.db.from("scheduled_jobs").delete().eq("id", id).select("id");

		if (data && data.length > 0) {
			await this.armTimer();
			return true;
		}
		return false;
	}

	async listJobs(): Promise<ScheduledJob[]> {
		const { data } = await this.db.from("scheduled_jobs").select("*").order("created_at", { ascending: false });

		const rows = (data ?? []) as JobRow[];
		return rows.map(rowToJob);
	}

	async getJob(id: string): Promise<ScheduledJob | null> {
		const { data } = await this.db.from("scheduled_jobs").select("*").eq("id", id).maybeSingle();

		return data ? rowToJob(data as JobRow) : null;
	}

	async runJobNow(id: string): Promise<string> {
		const job = await this.getJob(id);
		if (!job) throw new Error(`Job not found: ${id}`);
		if (!job.enabled) throw new Error(`Job is disabled: ${id}`);

		const result = await this.executeJob(job);
		return result;
	}

	async armTimer(): Promise<void> {
		if (!this.running) return;

		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}

		const { data: row } = await this.db
			.from("scheduled_jobs")
			.select("next_run_at")
			.eq("enabled", true)
			.eq("status", "active")
			.not("next_run_at", "is", null)
			.order("next_run_at")
			.limit(1)
			.maybeSingle();

		if (!row?.next_run_at) return;

		const nextMs = new Date(row.next_run_at).getTime();
		const delay = Math.max(0, nextMs - Date.now());
		const clamped = Math.min(delay, MAX_TIMER_MS);

		this.timer = setTimeout(() => this.onTimer(), clamped);
	}

	private async onTimer(): Promise<void> {
		if (!this.running) return;

		// Concurrency guard: only one execution at a time
		if (this.executing) {
			await this.armTimer();
			return;
		}

		this.executing = true;

		try {
			const now = new Date().toISOString();
			const { data: dueRows } = await this.db
				.from("scheduled_jobs")
				.select("*")
				.eq("enabled", true)
				.eq("status", "active")
				.lte("next_run_at", now)
				.order("next_run_at");

			for (const row of (dueRows ?? []) as JobRow[]) {
				if (!this.running) break;
				const job = rowToJob(row);
				try {
					await this.executeJob(job);
				} catch (err: unknown) {
					const msg = err instanceof Error ? err.message : String(err);
					console.error(`[scheduler] Job ${job.id} (${job.name}) failed: ${msg}`);
				}
			}
		} finally {
			this.executing = false;
			await this.armTimer();
		}
	}

	private async executeJob(job: ScheduledJob): Promise<string> {
		const startMs = Date.now();
		console.log(`[scheduler] Executing job: ${job.name} (${job.id})`);

		let responseText = "";
		let runStatus: "ok" | "error" = "ok";
		let errorMsg: string | null = null;

		try {
			const response = await this.runtime.handleMessage("scheduler", `sched:${job.id}`, job.task);
			responseText = response.text;

			if (responseText.startsWith("Error:")) {
				runStatus = "error";
				errorMsg = responseText;
			}
		} catch (err: unknown) {
			runStatus = "error";
			errorMsg = err instanceof Error ? err.message : String(err);
			responseText = `Error: ${errorMsg}`;
		}

		const durationMs = Date.now() - startMs;
		const newConsecErrors = runStatus === "error" ? job.consecutiveErrors + 1 : 0;

		// Compute next run
		let nextRunAt: string | null = null;
		let newStatus = job.status;

		if (runStatus === "ok") {
			if (job.deleteAfterRun || job.schedule.kind === "at") {
				newStatus = "completed";
			} else {
				const nextRun = computeNextRunAt(job.schedule);
				nextRunAt = nextRun?.toISOString() ?? null;
			}
		} else {
			// Error path
			if (newConsecErrors >= MAX_CONSECUTIVE_ERRORS) {
				newStatus = "failed";
				this.notifyOwner(
					`Scheduled task "${job.name}" has failed ${MAX_CONSECUTIVE_ERRORS} times in a row and has been disabled. Last error: ${errorMsg}`,
				);
			} else if (job.schedule.kind === "at" && newConsecErrors >= 3) {
				newStatus = "failed";
			} else {
				const backoffDate = computeBackoffNextRun(newConsecErrors);
				nextRunAt = backoffDate.toISOString();
			}
		}

		await this.db
			.from("scheduled_jobs")
			.update({
				last_run_at: new Date(startMs).toISOString(),
				last_run_status: runStatus,
				last_run_duration_ms: durationMs,
				last_run_error: errorMsg,
				next_run_at: nextRunAt,
				run_count: job.runCount + 1,
				consecutive_errors: newConsecErrors,
				status: newStatus,
				updated_at: new Date().toISOString(),
			})
			.eq("id", job.id);

		// Delete completed one-shot jobs
		if (newStatus === "completed" && job.deleteAfterRun) {
			await this.db.from("scheduled_jobs").delete().eq("id", job.id);
		}

		// Deliver result
		if (runStatus === "ok" && responseText) {
			await this.deliverResult(job, responseText);
		}

		return responseText;
	}

	private async deliverResult(job: ScheduledJob, text: string): Promise<void> {
		if (job.delivery.channel === "none") return;

		if (job.delivery.channel === "slack" && this.slackChannel) {
			const target = job.delivery.target;

			// Enforce delivery target allowlist (owner is always permitted)
			if (target !== "owner" && this.deliveryAllowlist && !this.deliveryAllowlist.has(target)) {
				console.warn(`[scheduler] Delivery target ${target} not in allowlist, skipping delivery for job ${job.id}`);
				return;
			}

			if (target === "owner" && this.ownerUserId) {
				await this.slackChannel.sendDm(this.ownerUserId, text);
			} else if (target.startsWith("C")) {
				await this.slackChannel.postToChannel(target, text);
			} else if (target.startsWith("U")) {
				await this.slackChannel.sendDm(target, text);
			}
		}
	}

	private notifyOwner(text: string): void {
		if (this.slackChannel && this.ownerUserId) {
			this.slackChannel.sendDm(this.ownerUserId, text).catch((err: unknown) => {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`[scheduler] Failed to notify owner: ${msg}`);
			});
		}
	}

	private async recoverMissedJobs(): Promise<void> {
		const now = new Date().toISOString();
		const { data: missedRows } = await this.db
			.from("scheduled_jobs")
			.select("*")
			.eq("enabled", true)
			.eq("status", "active")
			.lt("next_run_at", now)
			.order("next_run_at");

		if (!missedRows || missedRows.length === 0) return;

		console.log(`[scheduler] Recovering ${missedRows.length} missed job(s)`);

		for (let i = 0; i < missedRows.length; i++) {
			const job = rowToJob(missedRows[i] as JobRow);

			// Stagger missed job execution to avoid overload
			if (i > 0) {
				await new Promise((resolve) => setTimeout(resolve, STARTUP_STAGGER_MS));
			}

			try {
				await this.executeJob(job);
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`[scheduler] Recovery of ${job.name} failed: ${msg}`);
			}
		}
	}
}

function rowToJob(row: JobRow): ScheduledJob {
	const schedule = parseScheduleValue(row.schedule_kind, row.schedule_value);
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		enabled: row.enabled,
		schedule,
		task: row.task,
		delivery: {
			channel: row.delivery_channel as "slack" | "none",
			target: row.delivery_target,
		},
		status: row.status as ScheduledJob["status"],
		lastRunAt: row.last_run_at,
		lastRunStatus: row.last_run_status as ScheduledJob["lastRunStatus"],
		lastRunDurationMs: row.last_run_duration_ms,
		lastRunError: row.last_run_error,
		nextRunAt: row.next_run_at,
		runCount: row.run_count,
		consecutiveErrors: row.consecutive_errors,
		deleteAfterRun: row.delete_after_run,
		createdAt: row.created_at,
		createdBy: row.created_by,
		updatedAt: row.updated_at,
	};
}
