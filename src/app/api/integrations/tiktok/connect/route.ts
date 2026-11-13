import { NextResponse } from "next/server";

import { requireCurrentUser } from "@/lib/auth/current-user";
import { requireGuild } from "@/lib/dashboard/require-guild";
import { createLogger } from "@/lib/logger";
import { clientKey, RateLimiter } from "@/lib/rate-limit";
import {
  getTrustedApplicationOrigin,
  getTikTokIntegrationStatus,
  getTikTokOAuthConfig,
  TIKTOK_REQUIRED_SCOPE,
} from "@/lib/tiktok/config";
import { buildTikTokAuthorizeUrl } from "@/lib/tiktok/oauth";
import { createTikTokOAuthAttempt } from "@/lib/tiktok/oauth-attempts";

const connectLimiter = new RateLimiter(10, 60_000);

/**
 * Start the owner-only, official TikTok Login Kit web flow.
 *
 * This is intentionally POST-only. The exact configured Origin is checked
 * before any state is created so a cross-site form cannot start a consent flow.
 */
export async function POST(request: Request): Promise<Response> {
  const log = createLogger("auth");
  const limit = connectLimiter.consume(clientKey(request));

  if (!isSameOriginRequest(request)) {
    log.warn("TikTok connect rejected for cross-site origin", {
      code: "ORIGIN_MISMATCH",
    });
    return safeErrorResponse("forbidden", 403);
  }

  if (!limit.allowed) {
    log.warn("TikTok connect rate limited", {
      retryAfterSeconds: limit.retryAfterSeconds,
    });
    return redirectWithError("rate_limited");
  }

  let status;
  try {
    status = getTikTokIntegrationStatus();
  } catch {
    log.error("TikTok connect configuration unavailable", {
      code: "CONFIG_INVALID",
    });
    return redirectWithError("not_available");
  }

  if (!status.enabled) {
    log.warn("TikTok connect requested while disabled", { reason: status.reason });
    return redirectWithError("not_available");
  }

  const config = getTikTokOAuthConfig();
  if (!config) return redirectWithError("not_available");

  // Both checks run on the server. The dashboard's hidden/disabled button is
  // presentation only and is not an authorization boundary.
  const user = await requireCurrentUser("/dashboard/streams");
  const guild = await requireGuild("/dashboard/streams");
  const requestedScopes = [TIKTOK_REQUIRED_SCOPE];
  let state;

  try {
    state = await createTikTokOAuthAttempt({
      userId: user.userId,
      guildId: guild.id,
      requestedScopes,
      redirectUri: config.redirectUri,
    });
  } catch {
    log.error("TikTok OAuth attempt could not be stored", {
      code: "OAUTH_ATTEMPT_STORAGE_FAILED",
    });
    return redirectWithError("not_available");
  }

  const authorizeUrl = buildTikTokAuthorizeUrl(
    config,
    state.state,
    requestedScopes,
  );

  const response = NextResponse.redirect(authorizeUrl, 303);

  // Keep this log free of the authorization URL, client key, and state.
  log.info("TikTok OAuth flow started", { userId: user.userId, guildId: guild.id });
  return response;
}

function isSameOriginRequest(request: Request): boolean {
  const trustedOrigin = getTrustedApplicationOrigin();
  return Boolean(trustedOrigin && request.headers.get("origin") === trustedOrigin);
}

function redirectWithError(error: string): NextResponse {
  const trustedOrigin = getTrustedApplicationOrigin();
  if (!trustedOrigin) return safeErrorResponse("not_available", 503);

  const destination = new URL("/dashboard/streams", trustedOrigin);
  destination.searchParams.set("tiktok", error);
  return NextResponse.redirect(destination);
}

function safeErrorResponse(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}
