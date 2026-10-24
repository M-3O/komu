import "server-only";

import { createLogger } from "@/lib/logger";
import { runStreamDetectionCycle } from "./poller";

/**
 * In-process timer for stream detection.
 *
 * Only started when `STREAM_POLL_INTERVAL_SECS` is set. Two passes at once
 * cannot double-alert — that rests on a unique constraint — but they are not
 * free: every pass reads every channel from its provider. A cycle that
 * outlives the interval used to stack: each tick started another pass, so a
 * provider that never answered multiplied the requests, and on YouTube each
 * stacked search spends 101 quota units on a channel that was already being
 * checked.
 *
 * A tick that arrives while the previous one is still running is therefore
 * skipped rather than queued. A queued pass would read the same state the
 * running one is about to act on.
 */

const log = createLogger("stream");

/** Guards against a second interval being registered on hot reload. */
const globalForPoller = globalThis as unknown as {
  komuStreamPoller?: NodeJS.Timeout;
  komuStreamPollerBoot?: NodeJS.Timeout;
};

/** Whether a detection pass is running right now. */
let inFlight = false;

export function startStreamPoller(intervalMs: number): void {
  if (globalForPoller.komuStreamPoller) {
    log.warn("Stream poller already running; not starting another");
    return;
  }

  log.info("Stream poller starting", { intervalMs });

  const tick = async () => {
    if (inFlight) {
      log.warn("Skipped a poll: the previous cycle is still running");
      return;
    }

    inFlight = true;

    try {
      const result = await runStreamDetectionCycle();

      // Only log when something happened, so an idle server stays quiet.
      if (result.alerted > 0 || result.failed.length > 0) {
        log.info("Poller cycle", { ...result });
      }
    } catch (error) {
      log.error("Poller cycle failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);

  // Do not hold the process open on shutdown.
  timer.unref?.();

  globalForPoller.komuStreamPoller = timer;

  // Run once shortly after start so a creator who just configured alerts does
  // not wait a full interval.
  const bootTimer = setTimeout(() => void tick(), 5_000);
  bootTimer.unref?.();

  globalForPoller.komuStreamPollerBoot = bootTimer;
}

/**
 * Stop the timer and clear the in-flight flag.
 *
 * Used by tests, and by anything that needs to shut the poller down without
 * exiting the process. Clearing the flag assumes no pass is mid-flight, which
 * is true of both.
 */
export function stopStreamPoller(): void {
  if (globalForPoller.komuStreamPoller) {
    clearInterval(globalForPoller.komuStreamPoller);
    delete globalForPoller.komuStreamPoller;
  }

  if (globalForPoller.komuStreamPollerBoot) {
    clearTimeout(globalForPoller.komuStreamPollerBoot);
    delete globalForPoller.komuStreamPollerBoot;
  }

  inFlight = false;
}
