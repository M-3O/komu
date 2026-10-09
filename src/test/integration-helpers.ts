/**
 * Shared helpers for integration tests.
 *
 * Every test needs a guild, and Komu is single-tenant: `prisma.guild.findFirst`
 * returns the one connected server. Rather than each test fighting over the
 * same rows, a test uses unique Discord ids for everything it creates and
 * removes them afterwards.
 *
 * Cleanup is best-effort and ordered children-first, because the foreign keys
 * cascade but an explicit order makes a failure readable.
 */

import { prisma } from "@/lib/db";

/** A fake Discord snowflake. Nothing is ever sent to Discord in these tests. */
export function fakeDiscordId(seed: number): string {
  return String(seed).padStart(18, "0");
}

/** The one guild these tests run against. */
export async function requireGuild() {
  const guild = await prisma.guild.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, xpEnabled: true },
  });

  if (!guild) {
    throw new Error(
      "No guild is connected. Run `npm run db:seed` before the integration tests.",
    );
  }

  return guild;
}

/**
 * Create a member row that no other test touches.
 *
 * The id is derived from the seed so a re-run finds and replaces its own rows
 * rather than accumulating them.
 */
export async function createTestMember(guildId: string, seed: number, overrides = {}) {
  const discordId = fakeDiscordId(seed);

  await prisma.guildMember.deleteMany({ where: { guildId, discordId } });

  return prisma.guildMember.create({
    data: {
      guildId,
      discordId,
      username: `test-${seed}`,
      ...overrides,
    },
  });
}

/** Remove everything a seeded member could have accumulated. */
export async function cleanupMember(guildId: string, seed: number) {
  const discordId = fakeDiscordId(seed);

  const member = await prisma.guildMember.findFirst({
    where: { guildId, discordId },
    select: { id: true },
  });

  if (!member) return;

  // Ordered so a failure points at the table that blocked the delete.
  await prisma.memberAchievement.deleteMany({ where: { memberId: member.id } });
  await prisma.challengeProgress.deleteMany({ where: { memberId: member.id } });
  await prisma.rewardGrant.deleteMany({ where: { memberId: member.id } });
  await prisma.moderationActionRecord.deleteMany({ where: { targetMemberId: member.id } });
  await prisma.streamAttendance.deleteMany({ where: { memberId: member.id } });
  await prisma.xPTransaction.deleteMany({ where: { memberId: member.id } });
  await prisma.memberXP.deleteMany({ where: { memberId: member.id } });
  await prisma.guildMember.deleteMany({ where: { id: member.id } });
}

/** A UTC midnight `days` ago, for placing rows inside a time window. */
export function daysAgo(days: number, hour = 12): Date {
  const now = new Date();
  const date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(hour);

  return date;
}