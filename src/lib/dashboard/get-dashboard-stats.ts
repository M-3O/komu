import "server-only";

import { requireCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";

/**
 * Headline counts for the dashboard overview.
 *
 * Reads independent rows in parallel rather than loading relations. Analytics
 * beyond this lives in `lib/analytics`; the connected channels are included
 * here because the overview's readiness panel needs them and the list is tiny.
 *
 * Calls `requireCurrentUser` itself rather than relying on the layout or
 * proxy. Each data function is its own boundary, so a future change to the
 * layout, a matcher, or a new entry point cannot silently expose these
 * counts.
 */
export async function getDashboardStats() {
  await requireCurrentUser();

  const [guild, memberCount, channels] = await Promise.all([
    prisma.guild.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, discordId: true, setupCompletedAt: true },
    }),
    prisma.guildMember.count(),
    prisma.streamingAccount.findMany({
      where: { disconnectedAt: null },
      select: {
        id: true,
        provider: true,
        username: true,
        displayName: true,
        alertConfig: { select: { enabled: true, channelId: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return {
    guild,
    memberCount,
    streamingAccountCount: channels.length,
    channels,
    alertsEnabled: channels.filter(
      (channel) => channel.alertConfig?.enabled && channel.alertConfig.channelId,
    ).length,
  };
}
