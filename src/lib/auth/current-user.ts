import "server-only";

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { manageableGuilds } from "./discord-permissions";
import { fetchDiscordGuilds } from "./discord-oauth";
import { getSession, requireSession } from "./session";

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
    },
  });

  if (!account) return null;

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
    // The cookie is valid but the account is gone: treat as signed out.
    throw new Error("Session is no longer valid. Please sign in again.");
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

  try {
    const guilds = await fetchDiscordGuilds(account.accessToken);
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

  const guilds = await fetchDiscordGuilds(account.accessToken);
  const match = manageableGuilds(guilds).find(
    (guild) => guild.id === guildDiscordId,
  );

  if (!match) {
    log.warn("Guild access check failed", { userId, guildDiscordId });
    return null;
  }

  return { id: match.id, name: match.name, icon: match.icon };
}

/**
 * Whether the signed-in user may configure the already-connected server.
 *
 * V1 manages a single server, so anyone without access to it has nothing to
 * do here.
 */
export async function canAccessPrimaryGuild(
  userId: string,
): Promise<boolean> {
  const guild = await prisma.guild.findFirst({
    orderBy: { createdAt: "asc" },
    select: { discordId: true },
  });

  if (!guild) return false;

  const access = await verifyGuildAccess(userId, guild.discordId);
  return access !== null;
}