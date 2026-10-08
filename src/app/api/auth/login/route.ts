import { NextResponse } from "next/server";

import { buildDiscordAuthorizeUrl } from "@/lib/auth/discord-oauth";
import {
  DEFAULT_REDIRECT_PATH,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session";
import { createLogger } from "@/lib/logger";
import { randomBytes } from "node:crypto";

/**
 * Start the Discord login flow.
 *
 * Generates a random `state`, stashes it in a short-lived cookie, and sends
 * the browser to Discord. The callback compares the two, which is what stops
 * a third-party site from feeding us an authorization code it obtained
 * elsewhere.
 *
 * GET /api/auth/login
 */
export async function GET(request: Request) {
  const log = createLogger("auth");
  const requestUrl = new URL(request.url);

  const state = randomBytes(32).toString("hex");
  const returnTo = sanitizeReturnTo(
    requestUrl.searchParams.get("returnTo"),
  );

  let authorizeUrl: string;
  try {
    authorizeUrl = buildDiscordAuthorizeUrl(state);
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
    name: `${SESSION_COOKIE_NAME}_oauth_state`,
    value: `${state}.${Buffer.from(returnTo).toString("base64url")}`,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
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