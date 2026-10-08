import "server-only";

import { io } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getAuthSecret } from "@/lib/config/server-config";
import {
  SESSION_TTL_SECONDS,
  signSessionToken,
  verifySessionToken,
  type SessionPayload,
} from "./session-crypto";

/**
 * Session cookie handling.
 *
 * The cookie is the source of truth for "is this request signed in".
 * Every protected page and every mutation goes through `requireSession`,
 * because `proxy.ts` only improves the redirect experience and is not a
 * substitute for server-side checks (see the Proxy docs).
 */

export const SESSION_COOKIE_NAME = "komu_session";

/** Where to send anonymous visitors. */
export const LOGIN_PATH = "/login";

/** Where to land after a successful login. */
export const DEFAULT_REDIRECT_PATH = "/dashboard";

/** Issue a session cookie for a user. */
export async function createSession(payload: {
  userId: string;
  discordId: string;
}): Promise<void> {
  const secret = getAuthSecret();
  if (!secret) {
    throw new Error(
      "AUTH_SECRET is not set. Add it to .env.local before signing in.",
    );
  }

  const token = signSessionToken(
    {
      userId: payload.userId,
      discordId: payload.discordId,
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    },
    secret,
  );

  const store = await cookies();

  store.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

/** Remove the session cookie. */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}

/** The current session, or null when signed out. */
export async function getSession(): Promise<SessionPayload | null> {
  // A missing or invalid AUTH_SECRET means no token can be trusted. Rather
  // than throw on every request, treat the visitor as signed out and let the
  // login page explain the problem.
  const secret = getAuthSecret();
  if (!secret) return null;

  // Expiry checking reads the clock. Next.js treats `Date.now()` during
  // prerendering as unstable output that cannot be baked into a static
  // shell, so the read is declared as an IO operation first. `io()` is the
  // documented choice under Cache Components: it suspends during
  // prerendering and resolves during a request.
  await io();

  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;

  return verifySessionToken(token, secret, Date.now());
}

/**
 * The current session, or a redirect to the login page.
 *
 * Use this at the top of every protected page and server action.
 */
export async function requireSession(
  returnTo?: string,
): Promise<SessionPayload> {
  const session = await getSession();

  if (!session) {
    const target = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";
    redirect(`${LOGIN_PATH}${target}`);
  }

  return session;
}