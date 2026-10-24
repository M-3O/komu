import { redirect } from "next/navigation";

import { endSession } from "@/lib/auth/end-session";
import { destroySession, getSession } from "@/lib/auth/session";
import { clientKey, RateLimiter } from "@/lib/rate-limit";

/**
 * Sign-out performs a database write and a Discord call, so a loop is worth
 * stopping. A real browser signs out once.
 */
const logoutLimiter = new RateLimiter(20, 60_000);

/**
 * Sign out.
 *
 * POST only, so another site cannot force a visitor to log out by sending
 * them to a URL. Ends every session for the user and revokes the Discord
 * token before clearing this browser's cookie.
 *
 * POST /logout
 */
export async function POST(request: Request) {
  const limit = logoutLimiter.consume(clientKey(request));

  if (!limit.allowed) {
    return new Response("Too many sign-out requests. Try again shortly.", {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfterSeconds) },
    });
  }

  const session = await getSession();

  if (session) {
    await endSession(session);
  }

  await destroySession();
  redirect("/");
}
