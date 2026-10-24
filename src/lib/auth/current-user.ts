import "server-only";

import { redirect } from "next/navigation";

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { manageableGuilds } from "./discord-permissions";
import { fetchDiscordGuilds } from "./discord-oauth";
import { getSession, requireSession, LOGIN_PATH } from "./session";
import { decryptToken } from "./token-crypto";

/**
 * The signed-in dashboard user.
 *
 * Server Components and Server Actions call these helpers instead of reading
 * the session cookie directly, so authorisation is enforced in one place.
 */

const log = createLogger("auth");

export interface CurrentUser {
  userId: string;
  discordId: string;
  username: string;
  avatarUrl: string | null;
}

/** The signed-in user, or null. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getSession();
  if (!session) return null;

  const account = await prisma.discordAccount.findUnique({
    where: { discordId: session.discordId },
    select: {
      discordId: true,
      username: true,
      avatarHash: true,
      userId: true,
      user: { select: { sessionVersion: true } },
    },
  });

  if (!account) return null;

  // Signing out bumps the user's version, which invalidates every token
  // issued before that moment. The check lives here because this is the one
  // place that already reads the user row; a self-contained token cannot
  // answer whether it has been revoked.
  if (account.user.sessionVersion !== session.sessionVersion) return null;

  return {
    userId: account.userId,
    discordId: account.discordId,
    username: account.username,
    avatarUrl: account.avatarHash
      ? `https://cdn.discordapp.com/avatars/${account.discordId}/${account.avatarHash}.png?size=128`
      : null,
  };
}

/** The signed-in user, or a redirect to the login page. */
export async function requireCurrentUser(
  returnTo?: string,
): Promise<CurrentUser> {
  await requireSession(returnTo);
  const user = await getCurrentUser();

  if (!user) {
    // The cookie is valid but the account is gone or its session version was
    // bumped by a sign-out. Send the visitor to the login screen rather than
    // an error boundary.
    redirect(LOGIN_PATH);
  }

  return user;
}

/**
 * The servers this user may configure, read fresh from Discord.
 *
 * Called on the setup screen so the list reflects current permissions rather
 * than whatever was cached at login time.
 */
export async function getManageableGuilds(
  userId: string,
): Promise<
  Array<{ id: string; name: string; icon: string | null }>
> {
  const account = await prisma.discordAccount.findFirst({
    where: { userId },
    select: { accessToken: true },
  });

  if (!account?.accessToken) {
    log.warn("No stored Discord token; cannot list guilds", { userId });
    return [];
  }

  const accessToken = decryptToken(account.accessToken);

  if (!accessToken) {
    // Written under a different AUTH_SECRET, or tampered with. Only a fresh
    // sign-in can fix it, and an empty list is the honest answer meanwhile.
    log.error("Stored Discord token could not be decrypted; sign-in required", {
      userId,
    });
    return [];
  }

  try {
    const guilds = await fetchDiscordGuilds(accessToken);
    return manageableGuilds(guilds).map((guild) => ({
      id: guild.id,
      name: guild.name,
      icon: guild.icon,
    }));
  } catch (error) {
    // Discord being unavailable should not take down the page; the setup
    // screen shows a retry hint instead.
    log.error("Could not load manageable guilds", {
      userId,
      reason: error instanceof Error ? error.message : "unknown",
    });
    throw error;
  }
}

/**
 * Re-read the user's guild list from Discord and confirm they can administer
 * the given server.
 *
 * Every guild-selection mutation calls this. The guild id arrives from the
 * browser, so it is treated as untrusted input and looked up again here
 * (PRD section 11).
 */
export async function verifyGuildAccess(
  userId: string,
  guildDiscordId: string,
): Promise<{ id: string; name: string; icon: string | null } | null> {
  const account = await prisma.discordAccount.findFirst({
    where: { userId },
    select: { accessToken: true },
  });

  if (!account?.accessToken) return null;

  const accessToken = decryptToken(account.accessToken);

  if (!accessToken) {
    log.error("Stored Discord token could not be decrypted; sign-in required", {
      userId,
    });
    return null;
  }

  const guilds = await fetchDiscordGuilds(accessToken);
  const match = manageableGuilds(guilds).find(
    (guild) => guild.id === guildDiscordId,
  );

  if (!match) {
    log.warn("Guild access check failed", { userId, guildDiscordId });
    return null;
  }

  return { id: match.id, name: match.name, icon: match.icon };
}

/** The connected server. V1 manages exactly one. */
export interface PrimaryGuild {
  id: string;
  name: string;
  discordId: string;
  ownerId: string | null;
}

/** The connected server, or null before setup has run. */
export async function getPrimaryGuild(): Promise<PrimaryGuild | null> {
  return prisma.guild.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, discordId: true, ownerId: true },
  });
}

/**
 * The outcome of an access check.
 *
 * `unavailable` is kept apart from `denied` because the two need different
 * answers: Discord being unreachable says nothing about the caller, and
 * telling an administrator they lack permission would send them looking for
 * a problem that is not theirs.
 */
export type GuildAccess = "granted" | "denied" | "unavailable";

/**
 * Whether this user may configure the given server.
 *
 * The owner recorded at setup is answered without a network call. That is the
 * common case, it keeps a settings save from waiting on Discord, and it means
 * an outage cannot lock the person who connected the server out of it.
 *
 * Everyone else is checked against Discord, because a co-administrator of the
 * same server has as much right to be here and the local row cannot say who
 * they are. The answer is deliberately not cached: a permission revoked in
 * Discord should stop working here immediately, not at the end of a TTL.
 */
export async function checkGuildAccess(
  userId: string,
  guild: Pick<PrimaryGuild, "discordId" | "ownerId">,
): Promise<GuildAccess> {
  if (guild.ownerId === userId) return "granted";

  try {
    return (await verifyGuildAccess(userId, guild.discordId))
      ? "granted"
      : "denied";
  } catch (error) {
    log.error("Could not verify guild access", {
      userId,
      guildDiscordId: guild.discordId,
      reason: error instanceof Error ? error.message : "unknown",
    });

    return "unavailable";
  }
}