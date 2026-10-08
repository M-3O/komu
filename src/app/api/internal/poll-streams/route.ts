import { timingSafeEqual } from "node:crypto";

import { createLogger } from "@/lib/logger";
import { runStreamDetectionCycle } from "@/lib/streams/poller";

/**
 * Run one stream detection pass.
 *
 * The polling mechanism is isolated in `lib/streams/poller.ts`; this is only
 * a trigger. Point an external cron at it, or set `STREAM_POLL_INTERVAL_SECS`
 * to let the app poll itself (see `instrumentation.ts`).
 *
 *   GET /api/internal/poll-streams
 *
 * Protected by a shared secret because it posts to Discord. Without one,
 * anyone who found the URL could use the bot to send messages.
 */

const log = createLogger("stream");

/** Constant-time check so the secret cannot be discovered byte by byte. */
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;

  const left = Buffer.from(provided);
  const right = Buffer.from(expected);

  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function GET(request: Request) {
  const expected = process.env.STREAM_POLL_SECRET;

  // Refusing to run unconfigured is safer than allowing an open endpoint.
  if (!expected) {
    log.error("STREAM_POLL_SECRET is not set; refusing to run the poll cycle");
    return Response.json(
      { error: "Polling is not configured." },
      { status: 503 },
    );
  }

  const provided =
    request.headers.get("x-poll-secret") ??
    new URL(request.url).searchParams.get("secret");

  if (!secretMatches(provided, expected)) {
    log.warn("Rejected poll request with a bad secret");
    return Response.json({ error: "Not authorised." }, { status: 401 });
  }

  const startedAt = Date.now();
  const result = await runStreamDetectionCycle();

  log.info("Detection cycle finished", {
    ...result,
    durationMs: Date.now() - startedAt,
  });

  return Response.json(result);
}