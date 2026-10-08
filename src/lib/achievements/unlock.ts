import { XPSource } from "@prisma/client";
import type { GuildMember } from "discord.js";

import { addRoleToMember } from "@/bot/services/moderation";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { awardXp } from "@/lib/xp/award-xp";
import { partitionUnlocks, type AchievementInput } from "./evaluate";

/**
 * Unlocking achievements.
 *
 * An achievement unlocks once and stays unlocked. The unique constraint on
 * (achievementId, memberId) is what enforces that, and the insert's row count
 * decides whether the payout happens at all: if the insert was a duplicate,
 * nothing is awarded. That ties paying out to actually being the first, rather
 * than checking and then writing as two steps that can disagree.
 *
 * Deliberately not marked `server-only`: the standalone bot imports this, and
 * that marker throws outside a Next.js server bundle.
 */

const log = createLogger("xp");

export interface UnlockAchievementsResult {
  /** Achievements newly unlocked and paid out. */
  unlocked: Array<{ id: string; name: string; icon: string }>;
  /** Achievements unlocked, but something in the payout failed. */
  partial: Array<{ name: string; reason: string }>;
  /** Achievements not unlocked, with the reason. */
  skipped: number;
}

/**
 * Unlock every achievement a member has earned.
 *
 * Safe to call on every message: the uniqueness check and the enabled check
 * make repeat calls no-ops.
 */
export async function unlockAchievementsForMember(input: {
  member: GuildMember;
  guildId: string;
  now?: Date;
}): Promise<UnlockAchievementsResult> {
  const result: UnlockAchievementsResult = { unlocked: [], partial: [], skipped: 0 };

  const now = input.now ?? new Date();

  // `member.id` is a Discord snowflake; the member row is keyed separately.
  const memberRow = await prisma.guildMember.findFirst({
    where: { guildId: input.guildId, discordId: input.member.id },
    select: {
      id: true,
      xp: true,
      level: true,
      messageCount: true,
      streamAttendanceCount: true,
      watchTimeMinutes: true,
      joinedAt: true,
    },
  });

  if (!memberRow) return result;

  const [achievements, unlocked] = await Promise.all([
    prisma.achievement.findMany({
      where: { guildId: input.guildId, enabled: true },
      select: { id: true, name: true, icon: true, type: true, threshold: true, enabled: true },
    }),
    prisma.memberAchievement.findMany({
      where: { guildId: input.guildId, memberId: memberRow.id },
      select: { achievementId: true },
    }),
  ]);

  if (achievements.length === 0) return result;

  const unlockedIds = unlocked.map((entry) => entry.achievementId);

  const { eligible, skipped } = partitionUnlocks(
    achievements as AchievementInput[],
    {
      xp: memberRow.xp,
      level: memberRow.level,
      messageCount: memberRow.messageCount,
      streamAttendanceCount: memberRow.streamAttendanceCount,
      watchTimeMinutes: memberRow.watchTimeMinutes,
      joinedAt: memberRow.joinedAt,
    },
    unlockedIds,
    now,
  );

  result.skipped = skipped.length;

  for (const achievement of achievements as AchievementInput[]) {
    if (!eligible.some((candidate) => candidate.id === achievement.id)) continue;

    // One at a time, because the row count decides the payout. A batch would
    // report a single total and lose which ones were actually new.
    const created = await prisma.memberAchievement.createMany({
      data: {
        guildId: input.guildId,
        achievementId: achievement.id,
        memberId: memberRow.id,
      },
      skipDuplicates: true,
    });

    // Somebody unlocked it between the check and the insert. Nothing to pay.
    if (created.count === 0) {
      result.skipped += 1;
      continue;
    }

    const full = await prisma.achievement.findUniqueOrThrow({
      where: { id: achievement.id },
      select: { id: true, name: true, icon: true, xpReward: true, roleId: true, roleName: true },
    });

    const problems: string[] = [];

    if (full.xpReward > 0) {
      // Bypasses the daily cap: an achievement is a deliberate payout, not
      // something earned by grinding messages.
      const outcome = await awardXp({
        guildId: input.guildId,
        memberId: memberRow.id,
        amount: full.xpReward,
        source: XPSource.ACHIEVEMENT,
        reason: `Achievement unlocked: ${full.name}`,
        ignoreDailyCap: true,
      });

      if (outcome.awarded <= 0) problems.push("XP was not awarded.");
    }

    if (full.roleId) {
      const outcome = await addRoleToMember(input.member, full.roleId);

      if (!outcome.ok) {
        problems.push(
          `Could not add @${full.roleName ?? "role"}: ${outcome.error ?? "unknown"}`,
        );
      }
    }

    if (problems.length === 0) {
      result.unlocked.push({ id: full.id, name: full.name, icon: full.icon });
      log.info("Achievement unlocked", {
        guildId: input.guildId,
        memberId: memberRow.id,
        achievement: full.name,
      });
    } else {
      // Still counted as unlocked. Re-running the payout would award the XP
      // again, because the uniqueness check would now report it as already
      // unlocked and skip it entirely.
      result.partial.push({ name: full.name, reason: problems.join("; ") });
      log.warn("Achievement payout incomplete", {
        guildId: input.guildId,
        memberId: memberRow.id,
        achievement: full.name,
        reason: problems.join("; "),
      });
    }
  }

  return result;
}

/** Achievements a member has unlocked, newest first. */
export async function getMemberAchievements(
  guildId: string,
  memberId: string,
) {
  return prisma.memberAchievement.findMany({
    where: { guildId, memberId },
    select: {
      id: true,
      unlockedAt: true,
      achievement: {
        select: { id: true, name: true, description: true, icon: true, hidden: true },
      },
    },
    orderBy: { unlockedAt: "desc" },
  });
}

/** Ids a member has unlocked. */
export async function getUnlockedAchievementIds(
  guildId: string,
  memberId: string,
): Promise<string[]> {
  const rows = await prisma.memberAchievement.findMany({
    where: { guildId, memberId },
    select: { achievementId: true },
  });

  return rows.map((row) => row.achievementId);
}