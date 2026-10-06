import "server-only";

import { prisma } from "@/lib/db";

/**
 * Headline counts for the dashboard overview.
 *
 * Deliberately reads three independent counts in parallel rather than
 * loading relations. Analytics beyond this lives in `lib/analytics` and
 * arrives in Phase 13.
 */
export async function getDashboardStats() {
  const [guild, memberCount, streamingAccountCount] = await Promise.all([
    prisma.guild.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, discordId: true, setupCompletedAt: true },
    }),
    prisma.guildMember.count(),
    prisma.streamingAccount.count({ where: { disconnectedAt: null } }),
  ]);

  return { guild, memberCount, streamingAccountCount };
}