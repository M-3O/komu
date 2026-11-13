import { NextResponse } from "next/server";

import { requireCurrentUser } from "@/lib/auth/current-user";
import { requireGuild } from "@/lib/dashboard/require-guild";
import { createLogger } from "@/lib/logger";
import { clientKey, RateLimiter } from "@/lib/rate-limit";
import {
  getTrustedApplicationOrigin,
  getTikTokIntegrationStatus,
  getTikTokOAuthConfig,
} from "@/lib/tiktok/config";
import { saveTikTokConnection } from "@/lib/tiktok/connection-store";
import {
  exchangeTikTokCode,
  fetchTikTokUserInfo,
  parseTikTokScopes,
  revokeTikTokAccessToken,
  safeTikTokErrorCategory,
  TikTokApiError,
  validateTikTokScopes,
} from "@/lib/tiktok/oauth";
import {
  consumeTikTokOAuthAttempt,
} from "@/lib/tiktok/oauth-attempts";
import { isValidTikTokOAuthState } from "@/lib/tiktok/oauth-state";

const callbackLimiter = new RateLimiter(20, 60_000);

/**
 * Finish the official TikTok Login Kit flow.
 *
 * The attempt is consumed atomically before any provider code exchange. The
 * exchanged credentials are stored only after identity and scope validation.
 */
export async function GET(request: Request): Promise<Response> {
  const log = createLogger("auth");
  const requestUrl = new URL(request.url);
  const limit = callbackLimiter.consume(clientKey(request));

  if (!limit.allowed) {
    log.warn("TikTok OAuth callback rate limited", {
      retryAfterSeconds: limit.retryAfterSeconds,
    });
    return redirectWithError("rate_limited");
  }

  const returnedState = requestUrl.searchParams.get("state");
  if (!isValidTikTokOAuthState(returnedState)) {
    log.warn("TikTok OAuth state rejected", { code: "STATE_MISMATCH" });
    return redirectWithError("state_mismatch");
  }

  let status;
  try {
    status = getTikTokIntegrationStatus();
  } catch {
    return redirectWithError("not_available");
  }

  if (!status.enabled) return redirectWithError("not_available");

  const config = getTikTokOAuthConfig();
  if (!config) return redirectWithError("not_available");

  // Resolve authorization from the current server-side session, not from any
  // browser-supplied owner or guild value.
  const user = await requireCurrentUser("/dashboard/streams");
  const guild = await requireGuild("/dashboard/streams");

  let attempt;
  try {
    attempt = await consumeTikTokOAuthAttempt({
      state: returnedState,
      userId: user.userId,
      guildId: guild.id,
    });
  } catch {
    log.error("TikTok OAuth attempt could not be consumed", {
      code: "OAUTH_ATTEMPT_CONSUME_FAILED",
    });
    return redirectWithError("oauth_failed");
  }
  if (!attempt || attempt.redirectUri !== config.redirectUri) {
    log.warn("TikTok OAuth owner binding rejected", { code: "OWNER_MISMATCH" });
    return redirectWithError("state_mismatch");
  }

  const providerError = requestUrl.searchParams.get("error");
  if (providerError) {
    log.warn("TikTok authorization was not granted", {
      code: providerError === "access_denied" ? "ACCESS_DENIED" : "OAUTH_FAILED",
    });
    return redirectWithError(
      providerError === "access_denied" ? "denied" : "oauth_failed",
    );
  }

  const code = requestUrl.searchParams.get("code");
  if (!code || code.length > 4096) {
    return redirectWithError("oauth_failed");
  }

  let exchangedAccessToken: string | null = null;
  try {
    const token = await exchangeTikTokCode(code, config);
    exchangedAccessToken = token.access_token;
    const grantedScopes = parseTikTokScopes(token.scope);
    const scopeCheck = validateTikTokScopes(
      grantedScopes,
      attempt.requestedScopes,
    );

    if (!scopeCheck.valid || !scopeCheck.requiredGranted) {
      await revokeQuietly(token.access_token, config, log);
      return redirectWithError("scope_denied");
    }

    const userInfo = await fetchTikTokUserInfo(token.access_token);
    if (userInfo.open_id !== token.open_id) {
      await revokeQuietly(token.access_token, config, log);
      log.error("TikTok OAuth identity mismatch", { code: "IDENTITY_MISMATCH" });
      return redirectWithError("oauth_failed");
    }

    await saveTikTokConnection({
      guildId: guild.id,
      connectedByUserId: user.userId,
      token,
      userInfo,
    });
    exchangedAccessToken = null;
    log.info("TikTok OAuth connection stored", { guildId: guild.id });
    return redirectWithSuccess("connected");
  } catch (error) {
    if (exchangedAccessToken) {
      await revokeQuietly(exchangedAccessToken, config, log);
    }
    log.error("TikTok OAuth callback failed", {
      code: error instanceof TikTokApiError
        ? safeTikTokErrorCategory(error)
        : "OAUTH_CALLBACK_FAILED",
    });
    return redirectWithError("oauth_failed");
  }
}

async function revokeQuietly(
  accessToken: string,
  config: NonNullable<ReturnType<typeof getTikTokOAuthConfig>>,
  log: ReturnType<typeof createLogger>,
): Promise<void> {
  try {
    await revokeTikTokAccessToken(accessToken, config);
  } catch (error) {
    log.error("TikTok token revocation failed", {
      code: error instanceof TikTokApiError
        ? safeTikTokErrorCategory(error)
        : "REVOKE_FAILED",
    });
  }
}

function redirectWithError(error: string): NextResponse {
  return redirectToDashboard("tiktok", error);
}

function redirectWithSuccess(result: string): NextResponse {
  return redirectToDashboard("tiktok", result);
}

function redirectToDashboard(key: string, value: string): NextResponse {
  const trustedOrigin = getTrustedApplicationOrigin();
  if (!trustedOrigin) {
    return NextResponse.json(
      { error: "not_available" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const destination = new URL("/dashboard/streams", trustedOrigin);
  destination.searchParams.set(key, value);
  return NextResponse.redirect(destination);
}
