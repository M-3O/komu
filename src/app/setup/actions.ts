"use server";

import { redirect } from "next/navigation";

import {
  checkGuildAccess,
  requireCurrentUser,
  verifyGuildAccess,
} from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";

/**
 * Connect a Discord server to this Komu installation.
 *
 * The submitted guild id is treated as untrusted: it is checked against the
 * user's live guild list from Discord before anything is written, and the
 * name and icon come from Discord's response rather than the form
 * (PRD section 11).
 */
export async function connectGuildAction(
  guildDiscordId: string,
): Promise<{ error: string } | never> {
  const log = createLogger("auth");

  const user = await requireCurrentUser("/setup");

  const access = await verifyGuildAccess(user.userId, guildDiscordId);
  if (!access) {
    return {
      error:
        "You need to be the owner or an administrator of that server. Sign in with a different Discord account.",
    };
  }

  // V1 manages exactly one server. If one is already connected, replace it
  // rather than creating a second, so lookups stay unambiguous — but only for
  // someone who already administers it. Without the check below, anyone who
  // administers any server of their own could connect it here and take over
  // an installation that was not theirs.
  const connected = await prisma.guild.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, discordId: true, ownerId: true },
  });

  if (connected && connected.discordId !== access.id) {
    const allowed = await checkGuildAccess(user.userId, connected);

    if (allowed !== "granted") {
      log.warn("Refused to replace the connected server", {
        userId: user.userId,
        connectedDiscordId: connected.discordId,
        requestedDiscordId: access.id,
        reason: allowed,
      });

      return {
        error:
          allowed === "unavailable"
            ? `Discord could not be reached, so your access to ${connected.name} could not be confirmed. Try again.`
            : `Komu is already connected to ${connected.name}. Only an owner or administrator of that server can connect a different one.`,
      };
    }
  }

  await prisma.$transaction(async (tx) => {
    if (connected) {
      await tx.guild.update({
        where: { id: connected.id },
        data: {
          discordId: access.id,
          name: access.name,
          iconHash: access.icon,
          ownerId: user.userId,
          setupCompletedAt: new Date(),
        },
      });
      return;
    }

    await tx.guild.create({
      data: {
        discordId: access.id,
        name: access.name,
        iconHash: access.icon,
        ownerId: user.userId,
        setupCompletedAt: new Date(),
      },
    });
  });

  log.info("Connected Discord server", {
    guildDiscordId: access.id,
    userId: user.userId,
  });

  redirect("/dashboard");
}