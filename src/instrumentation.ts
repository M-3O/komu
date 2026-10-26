/**
 * Process startup hook.
 *
 * Runs once when the Node server starts. Used to poll streaming providers on
 * a timer when the deployment has no external cron.
 *
 * Polling is off unless at least one interval is set, so a hosted deployment
 * that calls `/api/internal/poll-streams` from its own scheduler never double
 * polls.
 *
 * Two intervals exist because the providers have different limits:
 *
 * - `STREAM_POLL_INTERVAL_SECS` is the YouTube interval (and the fallback for
 *   every provider when the fast interval is not set). YouTube costs 101
 *   quota units per lookup, so 1800 seconds is the safe default.
 * - `STREAM_POLL_FAST_INTERVAL_SECS` covers Twitch and Kick, which can be
 *   checked every 60 seconds without that quota cost.
 *
 * A plain `setInterval` is fine for a self-hosted or single long-lived
 * server. It is not reliable on platforms that freeze idle instances, which
 * is why it is opt-in and why the endpoint exists as an alternative.
 */

/** Parse an interval in seconds, rejecting missing and unsafe values. */
function readInterval(name: string, raw: string | undefined): number | null {
  if (!raw) return null;

  const seconds = Number(raw);

  if (!Number.isFinite(seconds) || seconds < 15) {
    console.warn(`[streams] ${name}=${raw} ignored; use 15 or more.`);
    return null;
  }

  return seconds * 1_000;
}

export async function register() {
  // Only in the Node runtime, and never during a build.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const mainIntervalMs = readInterval(
    "STREAM_POLL_INTERVAL_SECS",
    process.env.STREAM_POLL_INTERVAL_SECS,
  );
  const fastIntervalMs = readInterval(
    "STREAM_POLL_FAST_INTERVAL_SECS",
    process.env.STREAM_POLL_FAST_INTERVAL_SECS,
  );

  if (!mainIntervalMs && !fastIntervalMs) return;

  const { startStreamPoller } = await import("@/lib/streams/poller-runtime");

  if (fastIntervalMs) {
    startStreamPoller(fastIntervalMs, {
      key: "fast",
      providers: ["TWITCH", "KICK"],
    });

    if (mainIntervalMs) {
      // The fast poller owns Twitch and Kick, so the slow one only needs
      // YouTube. This avoids spending Twitch/Kick requests twice.
      startStreamPoller(mainIntervalMs, {
        key: "youtube",
        providers: ["YOUTUBE"],
      });
    } else {
      console.warn(
        "[streams] STREAM_POLL_FAST_INTERVAL_SECS is set without STREAM_POLL_INTERVAL_SECS; YouTube channels will not be polled.",
      );
    }

    return;
  }

  if (mainIntervalMs) {
    // Backwards-compatible single poller: every provider on one interval.
    startStreamPoller(mainIntervalMs, { key: "all" });
  }
}
