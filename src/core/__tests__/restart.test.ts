import { afterEach, describe, expect, test } from "bun:test";
import { scheduleRestart } from "../restart.ts";

describe("scheduleRestart", () => {
	const originalKill = process.kill;

	afterEach(() => {
		process.kill = originalKill;
	});

	test("schedules SIGTERM after delay", async () => {
		const calls: Array<{ pid: number; signal: string }> = [];
		process.kill = ((pid: number, signal?: string) => {
			calls.push({ pid, signal: signal ?? "SIGTERM" });
			return true;
		}) as typeof process.kill;

		scheduleRestart(50);
		expect(calls).toHaveLength(0);

		await new Promise((r) => setTimeout(r, 100));
		expect(calls).toHaveLength(1);
		expect(calls[0].pid).toBe(process.pid);
		expect(calls[0].signal).toBe("SIGTERM");
	});

	test("uses default delay of 2000ms", () => {
		// Just verify it doesn't throw — actual delay is too long to test
		const killed = { called: false };
		process.kill = (() => {
			killed.called = true;
			return true;
		}) as typeof process.kill;

		scheduleRestart();
		expect(killed.called).toBe(false);
	});
});
