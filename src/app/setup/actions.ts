"use server";

import { redirect } from "next/navigation";

import { requireCurrentUser, verifyGuildAccess } from "@/lib/auth/current-user";
import { authorizeInstallationOwner } from "@/lib/auth/installation-owner";
import { prisma } from "@/lib/db";

/** Reconfigure the existing installation without claiming or transferring it. */
export async function connectGuildAction(
  guildDiscordId: string,
): Promise<{ error: string } | never> {
  const user = await requireCurrentUser("/setup");
  const authorization = await authorizeInstallationOwner(user);
  if (!authorization.ok) return { error: "Your access could not be verified." };

  try {
    // Retain the live Discord check for the requested server. Local ownership
    // does not grant Discord permissions in a different server.
    const access = await verifyGuildAccess(user.userId, guildDiscordId);
    if (!access) return { error: "Your access could not be verified." };

    const owner = authorization.owner;
    const result = await prisma.guild.updateMany({
      where: {
        id: owner.guildId,
        ownerId: owner.userId,
        discordId: owner.guildDiscordId,
      },
      data: {
        discordId: access.id,
        name: access.name,
        iconHash: access.icon,
        setupCompletedAt: new Date(),
      },
    });
    // The conditional write also rejects an ownership/configuration change
    // between authorization and persistence. There is no ownerId assignment.
    if (result.count !== 1) return { error: "Your access could not be verified." };
  } catch {
    return { error: "Your access could not be verified." };
  }

  redirect("/dashboard");
}
