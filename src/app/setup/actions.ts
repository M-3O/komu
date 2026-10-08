"use server";

import { redirect } from "next/navigation";

import { requireCurrentUser, verifyGuildAccess } from "@/lib/auth/current-user";
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
  // rather than creating a second, so lookups stay unambiguous.
  await prisma.$transaction(async (tx) => {
    const existing = await tx.guild.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    if (existing) {
      await tx.guild.update({
        where: { id: existing.id },
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