import { prisma } from "@/lib/db";
import { commitStreamAttendance, getAttendanceMember } from "@/lib/attendance/record-attendance";
import { checkInDeadline, lockSeason, seasonsEnabled } from "./lifecycle";

export const CHECK_IN_PREFIX = "komu:season:";

interface CheckInInput {
  broadcastId: string;
  guildDiscordId: string;
  channelId: string;
  messageId: string;
  discordUserId: string;
  username: string;
  nickname?: string | null;
  now?: Date;
}

export async function checkInToSeason(input: CheckInInput) {
  if (!seasonsEnabled()) return { error: "Season check-ins are unavailable." } as const;
  return prisma.$transaction(async (tx) => {
    const seed = await tx.seasonBroadcast.findFirst({
      where: { id: input.broadcastId, slot: { season: { guild: { discordId: input.guildDiscordId } } } },
      select: { slot: { select: { seasonId: true } } },
    });
    if (!seed) return { error: "This is not a season check-in for this server." } as const;
    await lockSeason(tx, seed.slot.seasonId);
    const broadcast = await tx.seasonBroadcast.findUnique({
      where: { id: input.broadcastId },
      include: { slot: { include: { season: true } }, stream: true },
    });
    if (broadcast?.supersededAt || !broadcast?.openedAt || broadcast.postChannelId !== input.channelId ||
        broadcast.postMessageId !== input.messageId || broadcast.slot.cancelledAt) {
      return { error: "This check-in post is no longer active." } as const;
    }
    const { season } = broadcast.slot;
    const now = input.now ?? new Date();
    if (season.status !== "ACTIVE" || +now < +broadcast.openedAt ||
        +now >= checkInDeadline(broadcast.openedAt, broadcast.stream.endedAt, season.endsAt)) {
      return { error: "This stream’s check-in window has closed." } as const;
    }
    const member = await getAttendanceMember(tx, season.guildId, input);
    const inserted = await tx.seasonCheckIn.createMany({
      data: { slotId: broadcast.slotId, memberId: member.id, checkedInAt: now },
      skipDuplicates: true,
    });
    const attendance = inserted.count
      ? await commitStreamAttendance(tx, broadcast.stream, member.id, "SEASON_CHECK_IN")
      : null;
    const count = await tx.seasonCheckIn.count({ where: { memberId: member.id, slot: { seasonId: season.id } } });
    if (count >= season.goal) {
      await tx.seasonRoleGrant.createMany({
        data: { seasonId: season.id, memberId: member.id, roleId: season.roleId },
        skipDuplicates: true,
      });
    }
    const grant = count >= season.goal
      ? await tx.seasonRoleGrant.findUnique({ where: { seasonId_memberId: { seasonId: season.id, memberId: member.id } } })
      : null;
    return { guildId: season.guildId, seasonName: season.name, count, goal: season.goal,
      credited: Boolean(inserted.count), newAttendance: Boolean(attendance), grantId: grant?.id,
      rewardStatus: grant?.status };
  }, { maxWait: 10_000, timeout: 15_000 });
}

export async function getMemberSeason(guildDiscordId: string, discordUserId: string, now = new Date()) {
  const season = await prisma.season.findFirst({
    where: { guild: { discordId: guildDiscordId }, status: "ACTIVE", endsAt: { gt: now } },
    select: { id: true, guildId: true, name: true, goal: true, endsAt: true },
  });
  if (!season) return null;
  const member = await prisma.guildMember.findUnique({
    where: { guildId_discordId: { guildId: season.guildId, discordId: discordUserId } },
    select: { id: true },
  });
  if (!member) return { ...season, count: 0, rewardStatus: undefined };
  const [count, grant] = await Promise.all([
    prisma.seasonCheckIn.count({ where: { memberId: member.id, slot: { seasonId: season.id } } }),
    prisma.seasonRoleGrant.findUnique({ where: { seasonId_memberId: { seasonId: season.id, memberId: member.id } } }),
  ]);
  return { ...season, count, rewardStatus: grant?.status };
}
