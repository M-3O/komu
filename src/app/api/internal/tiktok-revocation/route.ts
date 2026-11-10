import { timingSafeEqual } from "node:crypto";

import {
  getTikTokIntegrationStatus,
  getTikTokOAuthConfig,
} from "@/lib/tiktok/config";
import { runTikTokRevocationMaintenance } from "@/lib/tiktok/connection-store";

const MIN_SECRET_LENGTH = 32;

/**
 * Prepared, but hard-disabled, maintenance endpoint. It uses a separate
 * least-privilege secret and makes only bounded revocation attempts. No GET
 * handler exists, so proxies and browsers cannot trigger it by prefetching.
 */
export async function POST(request: Request): Promise<Response> {
  let status;
  try {
    status = getTikTokIntegrationStatus();
  } catch {
    return json({ error: "not_available" }, 503);
  }
  if (!status.enabled) return json({ error: "not_available" }, 503);

  const expected = process.env.TIKTOK_MAINTENANCE_SECRET;
  if (!expected || expected.length < MIN_SECRET_LENGTH) {
    return json({ error: "not_available" }, 503);
  }

  if (!secretMatches(request.headers.get("x-tiktok-maintenance-secret"), expected)) {
    return json({ error: "not_authorised" }, 401);
  }

  const config = getTikTokOAuthConfig();
  if (!config) return json({ error: "not_available" }, 503);

  try {
    const result = await runTikTokRevocationMaintenance(config, { maxItems: 10 });
    return json(result);
  } catch {
    return json({ error: "maintenance_unavailable" }, 503);
  }
}

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
