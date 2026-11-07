import "server-only";

import { prisma } from "@/lib/db";

export interface InstallationOwner {
  userId: string;
  discordId: string;
  guildId: string;
  guildDiscordId: string;
}

export type OwnerAuthorization =
  | { ok: true; owner: InstallationOwner }
  | { ok: false; reason: "access_denied" | "access_unavailable" };

/**
 * Temporary owner-only dashboard policy, independent of NODE_ENV.
 * Read fresh on every authorization: no first-login claim, admin fallback,
 * process cache, token reads, or ownership writes. Two guilds are ambiguous.
 */
export async function authorizeInstallationOwner(identity: {
  discordId: string;
  userId?: string;
}): Promise<OwnerAuthorization> {
  try {
    const guilds = await prisma.guild.findMany({
      take: 2,
      select: {
        id: true,
        discordId: true,
        ownerId: true,
        owner: {
          select: {
            id: true,
            discordAccount: { select: { userId: true, discordId: true } },
          },
        },
      },
    });

    const guild = guilds[0];
    const account = guild?.owner?.discordAccount;
    if (
      guilds.length !== 1 ||
      !guild.ownerId ||
      guild.owner?.id !== guild.ownerId ||
      account?.userId !== guild.ownerId ||
      !account.discordId ||
      account.discordId !== identity.discordId ||
      (identity.userId !== undefined && identity.userId !== guild.ownerId)
    ) {
      return { ok: false, reason: "access_denied" };
    }

    return {
      ok: true,
      owner: {
        userId: guild.ownerId,
        discordId: account.discordId,
        guildId: guild.id,
        guildDiscordId: guild.discordId,
      },
    };
  } catch {
    // Never propagate Prisma errors, connection details, or account data.
    return { ok: false, reason: "access_unavailable" };
  }
}
