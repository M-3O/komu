import { timingSafeEqual } from "node:crypto";

import { createLogger } from "@/lib/logger";
import { runStreamDetectionCycle } from "@/lib/streams/poller";

/**
 * Run one stream detection pass.
 *
 * The polling mechanism is isolated in `lib/streams/poller.ts`; this is only
 * a trigger. Point an external cron at it, or set the two in-process intervals
 * to let the app poll itself (see `instrumentation.ts`).
 *
 *   POST /api/internal/poll-streams
 *   x-poll-secret: <32+ characters>
 *
 * POST rather than GET because the pass posts to Discord. A state-changing
 * GET can be fired by an `<img src>` on any page a signed-in admin visits,
 * and proxies are entitled to cache or prefetch it.
 *
 * The secret is accepted in a header only. A `?secret=` parameter ends up in
 * proxy and CDN access logs, in the cron job's own history, and in `Referer`
 * headers if anything on the response links out.
 */

const log = createLogger("stream");

/**
 * Entropy floor.
 *
 * A short secret is worse than none: it looks configured while being
 * guessable. 32 characters is the low end of a real random value.
 */
const MIN_SECRET_LENGTH = 32;

/** Failed attempts allowed per client within the window. */
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 60_000;

/**
 * Failed attempts by client, oldest first.
 *
 * Per process rather than shared, so a multi-instance deployment gives each
 * instance its own budget. That still turns an online guess into a slow one;
 * the secret itself is 256 bits, so guessing was never the likely attack.
 */
const failures = new Map<string, number[]>();

function clientKey(request: Request): string {
  // The first entry is the client; the rest are proxies it passed through.
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function isLockedOut(key: string, now: number): boolean {
  const recent = (failures.get(key) ?? []).filter(
    (at) => now - at < FAILURE_WINDOW_MS,
  );

  if (recent.length === 0) {
    failures.delete(key);
    return false;
  }

  failures.set(key, recent);

  return recent.length >= MAX_FAILURES;
}

function recordFailure(key: string, now: number): void {
  // Opportunistically drop clients that have gone quiet, so a flood of
  // distinct addresses cannot grow the map without limit.
  if (failures.size > 1_000) {
    for (const [other, stamps] of failures) {
      if (now - (stamps.at(-1) ?? 0) >= FAILURE_WINDOW_MS) {
        failures.delete(other);
      }
    }
  }

  const recent = failures.get(key) ?? [];
  recent.push(now);
  failures.set(key, recent);
}

/** Constant-time check so the secret cannot be discovered byte by byte. */
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;

  const left = Buffer.from(provided);
  const right = Buffer.from(expected);

  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  const expected = process.env.STREAM_POLL_SECRET;

  // Refusing to run unconfigured is safer than allowing an open endpoint.
  if (!expected || expected.length < MIN_SECRET_LENGTH) {
    log.error(
      "STREAM_POLL_SECRET is missing or shorter than 32 characters; refusing to run the poll cycle",
      { configured: Boolean(expected), length: expected?.length ?? 0 },
    );

    return Response.json(
      { error: "Polling is not configured." },
      { status: 503 },
    );
  }

  const key = clientKey(request);
  const now = Date.now();

  if (isLockedOut(key, now)) {
    log.warn("Rejected poll request: too many failed attempts", {
      client: key,
    });

    return Response.json({ error: "Too many attempts." }, { status: 429 });
  }

  const provided = request.headers.get("x-poll-secret");

  if (!secretMatches(provided, expected)) {
    recordFailure(key, now);
    log.warn("Rejected poll request with a bad secret", { client: key });
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
