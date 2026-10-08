import "server-only";

import { requireCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";

/**
 * Headline counts for the dashboard overview.
 *
 * Deliberately reads three independent counts in parallel rather than
 * loading relations. Analytics beyond this lives in `lib/analytics` and
 * arrives in Phase 13.
 *
 * Calls `requireCurrentUser` itself rather than relying on the layout or
 * proxy. Each data function is its own boundary, so a future change to the
 * layout, a matcher, or a new entry point cannot silently expose these
 * counts.
 */
export async function getDashboardStats() {
  await requireCurrentUser();

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