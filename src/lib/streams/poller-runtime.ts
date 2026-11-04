import "server-only";

import type { StreamingProvider } from "@prisma/client";

import { classifyError, isErrorCode } from "@/lib/monitoring/errors";

import { createLogger } from "@/lib/logger";
import { runStreamDetectionCycle, type CycleResult } from "./poller";

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
  intervalMs: number;
  providers: readonly StreamingProvider[] | null;
  registeredAt: number;
  lastStartedAt: number | null;
  lastFinishedAt: number | null;
  lastSucceededAt: number | null;
  lastResult: CycleResult | null;
  lastError: string | null;
}

export interface StreamPollerSnapshot {
  key: string;
  intervalMs: number;
  /** Null means the poller covers every provider. */
  providers: StreamingProvider[] | null;
  inFlight: boolean;
  registeredAt: string;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastSucceededAt: string | null;
  lastResult: CycleResult | null;
  lastError: string | null;
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

  const state: PollerState = {
    inFlight: false,
    intervalMs,
    providers: options.providers ?? null,
    registeredAt: Date.now(),
    lastStartedAt: null,
    lastFinishedAt: null,
    lastSucceededAt: null,
    lastResult: null,
    lastError: null,
  };

  const tick = async () => {
    if (state.inFlight) {
      log.warn("Skipped a poll: the previous cycle is still running", { key });
      return;
    }

    state.inFlight = true;
    state.lastStartedAt = Date.now();

    try {
      const result = await runStreamDetectionCycle(options.providers);
      // Never retain account labels or raw reasons in the status snapshot.
      state.lastResult = { checked: result.checked, alerted: result.alerted, skipped: result.skipped, unchanged: result.unchanged, failed: result.failed.slice(0, 32).map(failure => ({
        channel: ["TWITCH", "KICK", "YOUTUBE"].includes(failure.channel) ? failure.channel : "stream",
        reason: isErrorCode(failure.reason) ? failure.reason : "JOB_FAILED",
      })) };
      if (result.failed.length === 0) {
        state.lastSucceededAt = Date.now();
        state.lastError = null;
      } else state.lastError = "JOB_PARTIAL";

      // Only log when something happened, so an idle server stays quiet.
      if (result.alerted > 0 || result.failed.length > 0) {
        log.info("Poller cycle", {
          key,
          providers: options.providers?.join(",") ?? "all",
          ...state.lastResult,
        });
      }
    } catch (error) {
      state.lastError = classifyError(error, "job");

      log.error("Poller cycle failed", {
        key,
        reason: state.lastError,
      });
    } finally {
      state.inFlight = false;
      state.lastFinishedAt = Date.now();
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
 * Snapshot the active timers for the protected status endpoint.
 *
 * This intentionally reports only scheduling state and the last cycle counts;
 * it never includes provider credentials or Discord message contents.
 */
export function getStreamPollerStatus(): StreamPollerSnapshot[] {
  return [...getPollers()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, state]) => ({
      key,
      intervalMs: state.intervalMs,
      providers: state.providers ? [...state.providers] : null,
      inFlight: state.inFlight,
      registeredAt: new Date(state.registeredAt).toISOString(),
      lastStartedAt:
        state.lastStartedAt === null
          ? null
          : new Date(state.lastStartedAt).toISOString(),
      lastFinishedAt:
        state.lastFinishedAt === null
          ? null
          : new Date(state.lastFinishedAt).toISOString(),
      lastSucceededAt: state.lastSucceededAt === null ? null : new Date(state.lastSucceededAt).toISOString(),
      lastResult: state.lastResult ? { ...state.lastResult, failed: state.lastResult.failed.map(failure => ({ ...failure })) } : null,
      lastError: state.lastError,
    }));
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
