import { createHash, randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { buildDiscordAuthorizeUrl } from "@/lib/auth/discord-oauth";
import {
  DEFAULT_REDIRECT_PATH,
  OAUTH_STATE_COOKIE_NAME,
} from "@/lib/auth/session";
import { createLogger } from "@/lib/logger";
import { clientKey, RateLimiter } from "@/lib/rate-limit";

/**
 * A burst against login mostly costs a redirect, so the ceiling is generous.
 * The point is to stop a loop that hammers Discord's authorize endpoint and
 * fills the logs, not to meter normal use.
 */
const loginLimiter = new RateLimiter(30, 60_000);

/**
 * Start the Discord login flow.
 *
 * Generates a random `state` and a PKCE verifier, stashes both in a
 * short-lived cookie, and sends the browser to Discord. The callback compares
 * the state, which is what stops a third-party site from feeding us an
 * authorization code it obtained elsewhere. PKCE adds the second half: even
 * if the code is intercepted, it cannot be exchanged without the verifier,
 * which never leaves this cookie.
 *
 * GET /api/auth/login
 */
export async function GET(request: Request) {
  const log = createLogger("auth");
  const requestUrl = new URL(request.url);
  const limit = loginLimiter.consume(clientKey(request));

  if (!limit.allowed) {
    log.warn("Discord login rate limited", {
      retryAfterSeconds: limit.retryAfterSeconds,
    });
    return NextResponse.redirect(
      new URL("/login?error=rate_limited", requestUrl),
    );
  }

  const state = randomBytes(32).toString("hex");
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  const returnTo = sanitizeReturnTo(
    requestUrl.searchParams.get("returnTo"),
  );

  let authorizeUrl: string;
  try {
    authorizeUrl = buildDiscordAuthorizeUrl(state, codeChallenge);
  } catch (error) {
    log.error("Cannot start Discord login", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.redirect(
      new URL("/login?error=not_configured", requestUrl),
    );
  }

  const response = NextResponse.redirect(authorizeUrl);

  response.cookies.set({
    name: OAUTH_STATE_COOKIE_NAME,
    value: Buffer.from(
      JSON.stringify({ state, returnTo, codeVerifier }),
    ).toString("base64url"),
    httpOnly: true,
    sameSite: "lax",
    // Required by the `__Host-` prefix.
    secure: true,
    path: "/",
    maxAge: 600,
  });

  return response;
}

/**
 * Only allow same-site relative paths, so `returnTo` cannot be used as an
 * open redirect to another site.
 */
function sanitizeReturnTo(value: string | null): string {
  if (!value) return DEFAULT_REDIRECT_PATH;
  if (!value.startsWith("/")) return DEFAULT_REDIRECT_PATH;
  // "//evil.com" and "/\evil.com" are protocol-relative URLs.
  if (value.startsWith("//") || value.startsWith("/\\")) {
    return DEFAULT_REDIRECT_PATH;
  }
  return value;
}