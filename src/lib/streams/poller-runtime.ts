import "server-only";

import { createLogger } from "@/lib/logger";
import { runStreamDetectionCycle } from "./poller";

/**
 * In-process timer for stream detection.
 *
 * Only started when `STREAM_POLL_INTERVAL_SECS` is set. Overlapping passes
 * are safe: the poller relies on a unique constraint rather than a lock.
 */

const log = createLogger("stream");

/** Guards against a second interval being registered on hot reload. */
const globalForPoller = globalThis as unknown as {
  komuStreamPoller?: NodeJS.Timeout;
};

export function startStreamPoller(intervalMs: number): void {
  if (globalForPoller.komuStreamPoller) {
    log.warn("Stream poller already running; not starting another");
    return;
  }

  log.info("Stream poller starting", { intervalMs });

  const tick = async () => {
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
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);

  // Do not hold the process open on shutdown.
  timer.unref?.();

  globalForPoller.komuStreamPoller = timer;

  // Run once shortly after start so a creator who just configured alerts does
  // not wait a full interval.
  setTimeout(() => void tick(), 5_000).unref?.();
}