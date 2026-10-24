import { timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  exchangeCodeForToken,
  fetchDiscordGuilds,
  fetchDiscordUser,
} from "@/lib/auth/discord-oauth";
import { manageableGuilds } from "@/lib/auth/discord-permissions";
import {
  createSession,
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
    log.warn("Discord login did not complete", {
      error: oauthError ?? "missing code or state",
    });
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
    const [discordUser, guilds] = await Promise.all([
      fetchDiscordUser(token.access_token),
      fetchDiscordGuilds(token.access_token),
    ]);

    const adminGuilds = manageableGuilds(guilds);

    const account = await upsertDiscordAccount({
      discordId: discordUser.id,
      username: discordUser.username,
      avatarHash: discordUser.avatar,
      // Encrypted before it reaches the row. Doing it here rather than in a
      // Prisma extension keeps the one write path obvious.
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

    log.info("Discord login succeeded", {
      discordId: discordUser.id,
      adminGuildCount: adminGuilds.length,
    });

    // V1 manages one server. If none is connected yet, or this person cannot
    // administer the connected one, send them to setup instead.
    const guild = await prisma.guild.findFirst({
      orderBy: { createdAt: "asc" },
      select: { discordId: true },
    });

    const canManageConnectedGuild =
      guild !== null &&
      adminGuilds.some((candidate) => candidate.id === guild.discordId);

    if (guild && !canManageConnectedGuild) {
      log.info("Signed-in user cannot manage the connected server", {
        discordId: discordUser.id,
      });
      destination = "/setup";
    } else if (!guild) {
      destination = "/setup";
    } else {
      destination = storedState.returnTo ?? "/dashboard";
    }
  } catch (error) {
    log.error("Discord callback failed", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    redirect("/login?error=login_failed");
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

async function upsertDiscordAccount(input: {
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

  const account = await prisma.discordAccount.upsert({
    where: { discordId: input.discordId },
    // A returning user keeps their existing dashboard account.
    update: details,
    create: {
      ...details,
      discordId: input.discordId,
      user: { create: {} },
    },
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