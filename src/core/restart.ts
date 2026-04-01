/**
 * Schedule a graceful self-restart by sending SIGTERM to the current process.
 * Docker's restart policy (unless-stopped) brings the container back with new config.
 */
export function scheduleRestart(delayMs = 2000): void {
	console.log(`[core] Scheduling restart in ${delayMs}ms`);
	setTimeout(() => {
		console.log("[core] Restarting...");
		process.kill(process.pid, "SIGTERM");
	}, delayMs);
}
