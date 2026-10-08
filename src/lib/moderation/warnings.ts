import { ModerationActionTypeRecord } from "@prisma/client";

import { prisma } from "@/lib/db";

/**
 * The warning system (PRD section 7.11).
 *
 * Warnings are `ModerationActionRecord` rows of type MANUAL_WARN, as the schema
 * documents, rather than a separate table. A warning is cleared by stamping
 * `warningClearedAt` rather than deleting the row, so there is still a record
 * that it existed.
 */

/** Record a warning against a member. */
export async function warnMember(input: {
  guildId: string;
  memberId: string;
  moderatorDiscordId: string;
  reason: string;
}): Promise<string> {
  const record = await prisma.moderationActionRecord.create({
    data: {
      guildId: input.guildId,
      type: ModerationActionTypeRecord.MANUAL_WARN,
      targetMemberId: input.memberId,
      moderatorDiscordId: input.moderatorDiscordId,
      reason: input.reason,
    },
    select: { id: true },
  });

  return record.id;
}

/**
 * Warnings a member has that still stand.
 *
 * Only uncleared ones count. A member who was warned twice and had both
 * warnings cleared has zero warnings, not two in history.
 */
export async function countActiveWarnings(guildId: string, memberId: string): Promise<number> {
  return prisma.moderationActionRecord.count({
    where: {
      guildId,
      targetMemberId: memberId,
      type: ModerationActionTypeRecord.MANUAL_WARN,
      warningClearedAt: null,
    },
  });
}

/** A member's warnings, newest first. */
export async function listWarnings(
  guildId: string,
  memberId: string,
  take = 20,
) {
  return prisma.moderationActionRecord.findMany({
    where: {
      guildId,
      targetMemberId: memberId,
      type: ModerationActionTypeRecord.MANUAL_WARN,
    },
    select: {
      id: true,
      createdAt: true,
      reason: true,
      moderatorDiscordId: true,
      warningClearedAt: true,
    },
    orderBy: { createdAt: "desc" },
    take,
  });
}

/**
 * Clear a member's standing warnings.
 *
 * Stamps the existing rows rather than inserting an un-warning, so the count
 * drops without losing the history.
 *
 * Returns how many were cleared, so the moderator can be told when there was
 * nothing to do.
 */
export async function clearWarnings(guildId: string, memberId: string): Promise<number> {
  const cleared = await prisma.moderationActionRecord.updateMany({
    where: {
      guildId,
      targetMemberId: memberId,
      type: ModerationActionTypeRecord.MANUAL_WARN,
      warningClearedAt: null,
    },
    data: { warningClearedAt: new Date() },
  });

  return cleared.count;
}

/**
 * Record any action taken, automated or manual.
 *
 * Every moderation decision lands here, so the dashboard and `/setup` can show
 * that moderation is actually running.
 */
export async function recordAction(input: {
  guildId: string;
  type: ModerationActionTypeRecord;
  targetMemberId: string;
  moderatorDiscordId?: string;
  reason?: string | null;
  durationMins?: number | null;
  ruleId?: string | null;
}): Promise<void> {
  await prisma.moderationActionRecord.create({
    data: {
      guildId: input.guildId,
      type: input.type,
      targetMemberId: input.targetMemberId,
      // "SYSTEM" rather than null, so every row says who was responsible.
      moderatorDiscordId: input.moderatorDiscordId ?? "SYSTEM",
      reason: input.reason ?? null,
      durationMins: input.durationMins ?? null,
      ruleId: input.ruleId ?? null,
    },
  });
}