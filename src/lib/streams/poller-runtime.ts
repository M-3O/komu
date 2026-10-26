import "server-only";

import type { StreamingProvider } from "@prisma/client";

import { createLogger } from "@/lib/logger";
import { runStreamDetectionCycle } from "./poller";

/**
 * In-process timers for stream detection.
 *
 * Twitch and Kick can be checked often. YouTube cannot: one lookup spends 101
 * quota units against a 10,000/day allowance, so it needs a slow interval.
 * Each named poller therefore gets its own timer and provider filter.
 *
 * A cycle that outlives its interval must not stack. Each tick starts a pass
 * only if that poller's previous pass has finished. A queued pass would read
 * the same state the running one is about to act on, and on YouTube every
 * stacked lookup spends quota on a channel already being checked.
 *
 * Two different pollers may run at once because they cover disjoint
 * providers. If an external cron also calls the endpoint, the database's
 * unique constraint still prevents duplicate alerts.
 */

const log = createLogger("stream");

interface PollerState {
  timer?: NodeJS.Timeout;
  boot?: NodeJS.Timeout;
  inFlight: boolean;
}

export interface StreamPollerOptions {
  /**
   * Names the timer. Starting the same key twice is ignored, which is what
   * keeps a hot reload from registering a duplicate interval.
   */
  key?: string;
  /**
   * Platforms this poller covers. Empty or omitted means every provider.
   */
  providers?: readonly StreamingProvider[];
}

/** Guards against duplicate intervals being registered on hot reload. */
const globalForPoller = globalThis as unknown as {
  komuStreamPollers?: Map<string, PollerState>;
};

function getPollers(): Map<string, PollerState> {
  if (!globalForPoller.komuStreamPollers) {
    globalForPoller.komuStreamPollers = new Map();
  }

  return globalForPoller.komuStreamPollers;
}

export function startStreamPoller(
  intervalMs: number,
  options: StreamPollerOptions = {},
): void {
  const key = options.key ?? "all";
  const pollers = getPollers();

  if (pollers.has(key)) {
    log.warn("Stream poller already running; not starting another", { key });
    return;
  }

  log.info("Stream poller starting", {
    key,
    intervalMs,
    providers: options.providers?.join(",") ?? "all",
  });

  const state: PollerState = { inFlight: false };

  const tick = async () => {
    if (state.inFlight) {
      log.warn("Skipped a poll: the previous cycle is still running", { key });
      return;
    }

    state.inFlight = true;

    try {
      const result = await runStreamDetectionCycle(options.providers);

      // Only log when something happened, so an idle server stays quiet.
      if (result.alerted > 0 || result.failed.length > 0) {
        log.info("Poller cycle", {
          key,
          providers: options.providers?.join(",") ?? "all",
          ...result,
        });
      }
    } catch (error) {
      log.error("Poller cycle failed", {
        key,
        reason: error instanceof Error ? error.message : "unknown",
      });
    } finally {
      state.inFlight = false;
    }
  };

  state.timer = setInterval(() => void tick(), intervalMs);

  // Do not hold the process open on shutdown.
  state.timer.unref?.();

  // Run once shortly after start so a creator who just configured alerts does
  // not wait a full interval.
  state.boot = setTimeout(() => void tick(), 5_000);
  state.boot.unref?.();

  pollers.set(key, state);
}

/**
 * Stop one named poller, or every poller when no key is given.
 *
 * Used by tests, and by anything that needs to shut polling down without
 * exiting the process.
 */
export function stopStreamPoller(key?: string): void {
  const pollers = getPollers();

  if (key) {
    stopPollers(pollers, [key]);
    return;
  }

  stopPollers(pollers, [...pollers.keys()]);
}

function stopPollers(
  pollers: Map<string, PollerState>,
  keys: readonly string[],
): void {
  for (const key of keys) {
    const state = pollers.get(key);

    if (!state) continue;

    if (state.timer) clearInterval(state.timer);
    if (state.boot) clearTimeout(state.boot);

    state.inFlight = false;
    pollers.delete(key);
  }
}
