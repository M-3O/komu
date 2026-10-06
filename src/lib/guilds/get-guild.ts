import "server-only";

import { prisma } from "@/lib/db";

/**
 * The single Discord server this deployment manages.
 *
 * V1 supports one guild, so most code paths read this instead of threading a
 * guild id through every function. When multi-server support arrives, these
 * call sites become `getGuildForSession(session)` (PRD section 10).
 */
export async function getPrimaryGuild() {
  return prisma.guild.findFirst({
    orderBy: { createdAt: "asc" },
  });
}

/** Like `getPrimaryGuild`, but throws when setup has not been completed. */
export async function requirePrimaryGuild() {
  const guild = await getPrimaryGuild();

  if (!guild) {
    throw new Error(
      "No Discord server is connected yet. Complete Discord OAuth setup first.",
    );
  }

  return guild;
}