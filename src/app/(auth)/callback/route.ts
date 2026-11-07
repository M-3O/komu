import { timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  exchangeCodeForToken,
  fetchDiscordGuilds,
  fetchDiscordUser,
} from "@/lib/auth/discord-oauth";
import { manageableGuilds } from "@/lib/auth/discord-permissions";
import { authorizeInstallationOwner } from "@/lib/auth/installation-owner";
import {
  createSession,
  destroySession,
  OAUTH_STATE_COOKIE_NAME,
} from "@/lib/auth/session";
import { encryptToken } from "@/lib/auth/token-crypto";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { clientKey, RateLimiter } from "@/lib/rate-limit";

/**
 * Each callback costs three Discord API calls, so a small burst ceiling is
 * enough. Normal sign-in uses one.
 */
const callbackLimiter = new RateLimiter(20, 60_000);

/**
 * Finish the Discord login flow.
 *
 * Discord sends the browser here with `?code=...&state=...`. We verify the
 * state, swap the code for a token, store the user, and issue a session.
 *
 * GET /callback
 */
export async function GET(request: Request) {
  const log = createLogger("auth");
  const requestUrl = new URL(request.url);
  const limit = callbackLimiter.consume(clientKey(request));

  if (!limit.allowed) {
    log.warn("OAuth callback rate limited", {
      retryAfterSeconds: limit.retryAfterSeconds,
    });
    redirect("/login?error=rate_limited");
  }

  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const oauthError = requestUrl.searchParams.get("error");

  // The visitor declined, or Discord reported a problem.
  if (oauthError || !code || !state) {
    log.warn("Discord login did not complete");
    await clearStateCookie();
    redirect("/login?error=oauth_failed");
  }

  const storedState = await readStateCookie();
  await clearStateCookie();

  if (!storedState || !statesMatch(storedState.state, state)) {
    log.warn("OAuth state mismatch; rejecting callback");
    redirect("/login?error=state_mismatch");
  }

  // `redirect()` signals by throwing a NEXT_REDIRECT error, so it must stay
  // outside this try/catch. A redirect raised from inside would be caught here
  // and rewritten into `login_failed`, turning every successful sign-in into a
  // failure. The try block therefore only decides *where* to go; the redirect
  // itself happens afterwards.
  let destination: string;

  try {
    const token = await exchangeCodeForToken(code, storedState.codeVerifier);
    const discordUser = await fetchDiscordUser(token.access_token);
    const access = await authorizeInstallationOwner({ discordId: discordUser.id });

    if (!access.ok) {
      // Refuse before storing tokens/accounts or issuing a new session. An old
      // browser session is cleared too; other sessions are checked on each use.
      await destroySession();
      destination = "/login?error=" + access.reason;
    } else {
      const guilds = await fetchDiscordGuilds(token.access_token);
      const adminGuilds = manageableGuilds(guilds);
      const account = await updateDiscordAccount({
        userId: access.owner.userId,
        discordId: discordUser.id,
        username: discordUser.username,
        avatarHash: discordUser.avatar,
        accessToken: encryptToken(token.access_token),
        tokenExpiresAt: token.expires_in
          ? new Date(Date.now() + token.expires_in * 1000)
          : null,
      });

      await createSession({
        userId: account.userId,
        discordId: account.discordId,
        sessionVersion: account.sessionVersion,
      });

      log.info("Discord login succeeded");
      const canManageConnectedGuild = adminGuilds.some(
        (candidate) => candidate.id === access.owner.guildDiscordId,
      );
      destination = canManageConnectedGuild
        ? storedState.returnTo ?? "/dashboard"
        : "/setup";
    }
  } catch {
    // Authentication failures must not log raw provider/Prisma errors.
    log.error("Discord callback failed", { code: "OAUTH_CALLBACK_FAILED" });
    await destroySession();
    destination = "/login?error=login_failed";
  }

  redirect(destination);
}

interface StoredState {
  state: string;
  returnTo: string | null;
  /** The PKCE verifier whose hash was sent in the authorize URL. */
  codeVerifier: string;
}

/** Read and unpack the one-shot state cookie set by /api/auth/login. */
async function readStateCookie(): Promise<StoredState | null> {
  const store = await cookies();
  const raw = store.get(OAUTH_STATE_COOKIE_NAME)?.value;

  if (!raw) return null;

  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;

  const candidate = parsed as Record<string, unknown>;

  if (
    typeof candidate.state !== "string" ||
    typeof candidate.codeVerifier !== "string"
  ) {
    return null;
  }

  // Only same-site relative paths, for the same reason the login route
  // sanitizes the value on the way in.
  const returnTo =
    typeof candidate.returnTo === "string" &&
    candidate.returnTo.startsWith("/") &&
    !candidate.returnTo.startsWith("//") &&
    !candidate.returnTo.startsWith("/\\")
      ? candidate.returnTo
      : null;

  return {
    state: candidate.state,
    codeVerifier: candidate.codeVerifier,
    returnTo,
  };
}

async function clearStateCookie(): Promise<void> {
  const store = await cookies();

  // Same reasoning as the session cookie: `__Host-` cookies require Secure
  // even on the response that expires them.
  store.set({
    name: OAUTH_STATE_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 0,
  });
}

/** Constant-time comparison of the stored and returned state values. */
function statesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

async function updateDiscordAccount(input: {
  userId: string;
  discordId: string;
  username: string;
  avatarHash: string | null;
  accessToken: string;
  tokenExpiresAt: Date | null;
}): Promise<{
  userId: string;
  discordId: string;
  sessionVersion: number;
}> {
  const details = {
    username: input.username,
    avatarHash: input.avatarHash,
    // Already encrypted by the caller.
    accessToken: input.accessToken,
    tokenExpiresAt: input.tokenExpiresAt,
  };

  // Private development mode only accepts the existing owner account. Never
  // recreate a missing account or silently rebind it to another dashboard user.
  const account = await prisma.discordAccount.update({
    where: { discordId: input.discordId, userId: input.userId },
    data: details,
    // The version is what makes sign-out revoke older tokens, so the new
    // session must be signed with the row's current value.
    include: { user: { select: { sessionVersion: true } } },
  });

  return {
    userId: account.userId,
    discordId: account.discordId,
    sessionVersion: account.user.sessionVersion,
  };
}