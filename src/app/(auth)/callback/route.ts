import { timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  exchangeCodeForToken,
  fetchDiscordGuilds,
  fetchDiscordUser,
} from "@/lib/auth/discord-oauth";
import { manageableGuilds } from "@/lib/auth/discord-permissions";
import { createSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";

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

  try {
    const token = await exchangeCodeForToken(code);
    const [discordUser, guilds] = await Promise.all([
      fetchDiscordUser(token.access_token),
      fetchDiscordGuilds(token.access_token),
    ]);

    const adminGuilds = manageableGuilds(guilds);

    const account = await upsertDiscordAccount({
      discordId: discordUser.id,
      username: discordUser.username,
      avatarHash: discordUser.avatar,
      accessToken: token.access_token,
      isGuildAdmin: adminGuilds.length > 0,
    });

    await createSession({
      userId: account.userId,
      discordId: account.discordId,
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
      redirect("/setup");
    }

    if (!guild) {
      redirect("/setup");
    }

    redirect(storedState.returnTo ?? "/dashboard");
  } catch (error) {
    log.error("Discord callback failed", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    redirect("/login?error=login_failed");
  }
}

interface StoredState {
  state: string;
  returnTo: string | null;
}

/** Read and unpack the one-shot state cookie set by /api/auth/login. */
async function readStateCookie(): Promise<StoredState | null> {
  const store = await cookies();
  const raw = store.get(`${SESSION_COOKIE_NAME}_oauth_state`)?.value;

  if (!raw) return null;

  const separator = raw.lastIndexOf(".");
  if (separator <= 0) return null;

  let returnTo: string | null = null;
  try {
    const decoded = Buffer.from(
      raw.slice(separator + 1),
      "base64url",
    ).toString("utf8");
    returnTo = decoded.startsWith("/") && !decoded.startsWith("//")
      ? decoded
      : null;
  } catch {
    returnTo = null;
  }

  return { state: raw.slice(0, separator), returnTo };
}

async function clearStateCookie(): Promise<void> {
  const store = await cookies();
  store.delete(`${SESSION_COOKIE_NAME}_oauth_state`);
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
  isGuildAdmin: boolean;
}): Promise<{ userId: string; discordId: string }> {
  const details = {
    username: input.username,
    avatarHash: input.avatarHash,
    accessToken: input.accessToken,
    isGuildAdmin: input.isGuildAdmin,
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
  });

  return { userId: account.userId, discordId: account.discordId };
}