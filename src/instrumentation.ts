/**
 * Process startup hook.
 *
 * Runs once when the Node server starts. Used to poll streaming providers on
 * a timer when the deployment has no external cron.
 *
 * Off unless `STREAM_POLL_INTERVAL_SECS` is set, so a hosted deployment that
 * calls `/api/internal/poll-streams` from its own scheduler never double
 * polls.
 *
 * A plain `setInterval` is fine for a self-hosted or single long-lived
 * server. It is not reliable on platforms that freeze idle instances, which
 * is why it is opt-in and why the endpoint exists as an alternative.
 */
export async function register() {
  // Only in the Node runtime, and never during a build.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const raw = process.env.STREAM_POLL_INTERVAL_SECS;

  if (!raw) return;

  const intervalMs = Number.parseInt(raw, 10) * 1000;

  if (!Number.isFinite(intervalMs) || intervalMs < 15_000) {
    console.warn(
      `[streams] STREAM_POLL_INTERVAL_SECS=${raw} ignored; use 15 or more.`,
    );
    return;
  }

  const { startStreamPoller } = await import("@/lib/streams/poller-runtime");

  startStreamPoller(intervalMs);
}