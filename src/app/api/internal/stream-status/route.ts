import { timingSafeEqual } from "node:crypto";

import { getStreamPollerStatus } from "@/lib/streams/poller-runtime";

/**
 * Read-only health check for the in-process stream pollers.
 *
 *   GET /api/internal/stream-status
 *   x-poll-secret: <32+ characters>
 *
 * This answers the question a deployment cannot answer by looking at the
 * public site: did the timers actually start, and when did each one last
 * finish? An empty `pollers` array usually means both interval variables are
 * unset, or the server has not been restarted since they were added.
 *
 * The secret is accepted in a header only. This route never starts a cycle,
 * posts to Discord, or polls a streaming provider.
 */

const MIN_SECRET_LENGTH = 32;

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;

  const left = Buffer.from(provided);
  const right = Buffer.from(expected);

  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request) {
  const expected = process.env.STREAM_POLL_SECRET;

  // Do not reveal whether a weak secret exists: treat it as unconfigured.
  if (!expected || expected.length < MIN_SECRET_LENGTH) {
    return json({ error: "Polling is not configured." }, 503);
  }

  const provided = request.headers.get("x-poll-secret");

  if (!secretMatches(provided, expected)) {
    return json({ error: "Not authorised." }, 401);
  }

  const pollers = getStreamPollerStatus();

  return json({
    generatedAt: new Date().toISOString(),
    activePollers: pollers.length,
    pollers,
  });
}
