import { XPSource, type Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { awardXp, type AwardXpResult } from "@/lib/xp/award-xp";

/**
 * Stream attendance.
 *
 * Discord exposes no watch telemetry, so attendance cannot be observed. A
 * member reacting to the live alert is the explicit signal V1 uses, which
 * is why the plan describes attendance as "where technically available"
 * (PRD section 7.5).
 *
 * The trade-off is honest: reacting proves someone was in the channel when
 * the alert posted, not that they watched. Treating it as engagement rather
 * than verified watch time is the point.
 *
 * Deliberately not marked `server-only`: the standalone bot imports this.
 */

const log = createLogger("stream");

/** XP awarded for showing up to a stream. */
export const ATTENDANCE_XP = 25;

export interface RecordAttendanceInput {
  /** Discord snowflake of the alert message that was reacted to. */
  alertMessageId: string;
  /** Reacting member's Discord snowflake. */
  discordUserId: string;
  guildDiscordId: string;
  username: string;
  nickname?: string | null;
}

export interface RecordAttendanceResult {
  /** False when the reaction was not on a known alert, or was a duplicate. */
  recorded: boolean;
  /** Why nothing was recorded. */
  reason?: "NOT_AN_ALERT" | "ALREADY_RECORDED" | "NO_GUILD";
  xp?: AwardXpResult;
}

/**
 * Record that a member attended a stream.
 *
 * Idempotent: the `StreamAttendance` unique constraint on
 * (streamId, memberId) rejects a second reaction, so reacting repeatedly, or
 * adding more emojis, cannot inflate the count.
 */
export async function recordStreamAttendance(
  input: RecordAttendanceInput,
): Promise<RecordAttendanceResult> {
  const stream = await prisma.stream.findFirst({
    where: { alertMessageId: input.alertMessageId },
    select: { id: true, guildId: true, title: true },
  });

  // A reaction on any other message is not attendance.
  if (!stream) return { recorded: false, reason: "NOT_AN_ALERT" };

  const guild = await prisma.guild.findFirst({
    where: { discordId: input.guildDiscordId },
    select: { id: true, xpEnabled: true, xpMessageAmount: true },
  });

  if (!guild || guild.id !== stream.guildId) {
    return { recorded: false, reason: "NO_GUILD" };
  }

  const member = await getAttendanceMember(prisma, stream.guildId, input);
  const xp = await prisma.$transaction(
    (tx) => commitStreamAttendance(tx, stream, member.id, "REACTION"),
    { maxWait: 10_000, timeout: 15_000 },
  );
  if (!xp) return { recorded: false, reason: "ALREADY_RECORDED" };

  log.info("Stream attendance recorded", {
    streamId: stream.id,
    memberId: member.id,
    guildId: stream.guildId,
  });
  return { recorded: true, xp };
}

export function getAttendanceMember(
  db: Prisma.TransactionClient,
  guildId: string,
  input: Pick<RecordAttendanceInput, "discordUserId" | "username" | "nickname">,
) {
  return db.guildMember.upsert({
    where: {
      guildId_discordId: {
        guildId,
        discordId: input.discordUserId,
      },
    },
    update: {
      username: input.username,
      nickname: input.nickname ?? undefined,
    },
    create: {
      guildId,
      discordId: input.discordUserId,
      username: input.username,
      nickname: input.nickname ?? null,
    },
    select: { id: true },
  });
}

export async function commitStreamAttendance(
  tx: Prisma.TransactionClient,
  stream: { id: string; guildId: string; title: string },
  memberId: string,
  method: "REACTION" | "SEASON_CHECK_IN",
) {
  await tx.$queryRaw`SELECT id FROM guild_members WHERE id = ${memberId} FOR UPDATE`;
  const [attendance] = await tx.streamAttendance.createManyAndReturn({
    data: { streamId: stream.id, memberId, method },
    skipDuplicates: true,
    select: { id: true },
  });
  if (!attendance) return null;
  await tx.guildMember.update({
    where: { id: memberId },
    data: { streamAttendanceCount: { increment: 1 } },
  });
  return awardAttendanceXp(tx, attendance.id, stream.guildId, memberId, stream.title);
}

export async function awardAttendanceXp(
  tx: Prisma.TransactionClient,
  attendanceId: string,
  guildId: string,
  memberId: string,
  title: string,
  repair = false,
) {
  const xp = await awardXp({
    guildId,
    memberId,
    amount: ATTENDANCE_XP,
    source: XPSource.STREAM_ATTENDANCE,
    attendanceId,
    reason: repair ? "Verified stream attendance XP correction"
      : title ? `Attended: ${title}` : "Stream attendance",
    ignoreDailyCap: true,
  }, tx);
  if (xp.awarded !== ATTENDANCE_XP) throw new Error("Attendance XP was not awarded in full.");
  return xp;
}
