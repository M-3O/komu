import { XPSource } from "@prisma/client";

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

  const member = await prisma.guildMember.upsert({
    where: {
      guildId_discordId: {
        guildId: stream.guildId,
        discordId: input.discordUserId,
      },
    },
    update: {
      username: input.username,
      nickname: input.nickname ?? undefined,
    },
    create: {
      guildId: stream.guildId,
      discordId: input.discordUserId,
      username: input.username,
      nickname: input.nickname ?? null,
    },
    select: { id: true },
  });

  // `skipDuplicates` is the deduplication mechanism rather than a try/catch.
  // Catching Prisma's unique-violation error would work too, but it logs a
  // prisma:error for every repeat reaction, and repeats are the normal case
  // here rather than a failure.
  const inserted = await prisma.$transaction(async (tx) => {
    const created = await tx.streamAttendance.createMany({
      data: {
        streamId: stream.id,
        memberId: member.id,
        method: "REACTION",
      },
      skipDuplicates: true,
    });

    if (created.count === 0) return false;

    await tx.guildMember.update({
      where: { id: member.id },
      data: { streamAttendanceCount: { increment: 1 } },
    });

    return true;
  });

  if (!inserted) {
    return { recorded: false, reason: "ALREADY_RECORDED" };
  }

  log.info("Stream attendance recorded", {
    streamId: stream.id,
    memberId: member.id,
    guildId: stream.guildId,
  });

  // Attendance is worth XP on its own, separate from messages. The daily
  // cap does not apply: the plan treats this as its own source, and a cap
  // sized for messages would silently swallow attendance.
  const xp = await awardXp({
    guildId: stream.guildId,
    memberId: member.id,
    amount: ATTENDANCE_XP,
    source: XPSource.STREAM_ATTENDANCE,
    reason: stream.title ? `Attended: ${stream.title}` : "Stream attendance",
    ignoreDailyCap: true,
  });

  return { recorded: true, xp };
}