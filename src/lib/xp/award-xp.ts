import { XPSource } from "@prisma/client";

import { prisma } from "@/lib/db";

/**
 * Deliberately not marked `server-only`.
 *
 * This module is shared between the Next.js app and the standalone bot
 * process, and `server-only` throws when loaded outside a Next.js server
 * bundle. Keeping it out is what lets `npm run bot` import this at all.
 */
import { levelForXp, xpForLevel } from "@/lib/levels/calculate-level";
import { createLogger } from "@/lib/logger";
import { applyDailyCap, dailyWindow } from "./daily-window";

/**
 * The XP transaction service.
 *
 * Every XP change goes through here so three things always happen together:
 *
 *   1. A transaction row is written, which is the real history
 *      (IMPLEMENTATION_PLAN section 9). Never store only a running total.
 *   2. The member's cached total and level are updated, so pages and
 *      leaderboards stay fast (PRD section 14).
 *   3. A level change is detected and reported to the caller.
 *
 * GuildMember.xp/level and MemberXP hold the same numbers. GuildMember is
 * the fast-read copy used by leaderboard queries; MemberXP carries the level
 * detail. Both are written in one transaction so they cannot drift.
 */

const log = createLogger("xp");

export interface AwardXpInput {
  guildId: string;
  /** `GuildMember.id`, not the Discord id. */
  memberId: string;
  /** Positive to award, negative to deduct. */
  amount: number;
  source: XPSource;
  reason?: string;
  /**
   * Skip the daily cap. Used for manual moderator grants and rewards, which
   * should not be silently reduced by a message-grinding limit.
   */
  ignoreDailyCap?: boolean;
}

export interface AwardXpResult {
  /** XP actually applied. Less than requested when the daily cap bit. */
  awarded: number;
  totalXp: number;
  previousLevel: number;
  newLevel: number;
  leveledUp: boolean;
  /** Set when the award was reduced or refused. */
  note?: string;
}

/**
 * Apply an XP change to a member.
 *
 * Returns a result rather than throwing for the ordinary "nothing to award"
 * cases, because callers (a bot reacting to a message, a reward evaluator)
 * need to continue, not crash.
 */
export async function awardXp(input: AwardXpInput): Promise<AwardXpResult> {
  // Prisma throws a validation error for an undefined `where`, which would
  // escape as an unhandled failure in a bot event handler. Treat it as a
  // missing member instead.
  if (!input.memberId || !input.guildId) {
    return {
      awarded: 0,
      totalXp: 0,
      previousLevel: 1,
      newLevel: 1,
      leveledUp: false,
      note: "Member not found.",
    };
  }

  return prisma.$transaction(async (tx) => {
    const member = await tx.guildMember.findUnique({
      where: { id: input.memberId },
      select: {
        id: true,
        xp: true,
        level: true,
        xpToday: true,
        xpTodayResetAt: true,
      },
    });

    if (!member) {
      return {
        awarded: 0,
        totalXp: 0,
        previousLevel: 1,
        newLevel: 1,
        leveledUp: false,
        note: "Member not found.",
      };
    }

    const previousLevel = member.level;
    const previousTotal = member.xp;

    const window = dailyWindow(member.xpToday, member.xpTodayResetAt);

    let amount = input.amount;

    // Deductions are never capped; the cap exists to limit grinding.
    if (amount > 0 && !input.ignoreDailyCap) {
      const guild = await tx.guild.findUnique({
        where: { id: input.guildId },
        select: { xpDailyCap: true },
      });

      amount = applyDailyCap(amount, window.xpToday, guild?.xpDailyCap ?? 0);
    }

    if (amount === 0) {
      return {
        awarded: 0,
        totalXp: previousTotal,
        previousLevel,
        newLevel: previousLevel,
        leveledUp: false,
        note:
          input.amount > 0
            ? "Daily XP cap reached."
            : "Nothing to award.",
      };
    }

    const totalXp = Math.max(previousTotal + amount, 0);
    const newLevel = levelForXp(totalXp);
    const xpToNextLevel = Math.max(xpForLevel(newLevel + 1) - totalXp, 0);

    // The transaction row is the history. Always write one.
    await tx.xPTransaction.create({
      data: {
        guildId: input.guildId,
        memberId: member.id,
        amount,
        source: input.source,
        reason: input.reason,
      },
    });

    await tx.guildMember.update({
      where: { id: member.id },
      data: {
        xp: totalXp,
        level: newLevel,
        xpToday: window.needsReset ? amount : member.xpToday + amount,
        xpTodayResetAt: window.resetAt,
      },
    });

    const levelUps = newLevel - previousLevel;

    await tx.memberXP.upsert({
      where: { memberId: member.id },
      update: {
        totalXp,
        level: newLevel,
        xpToNextLevel,
        ...(levelUps > 0 ? { lastLevelUpAt: new Date() } : {}),
      },
      create: {
        memberId: member.id,
        guildId: input.guildId,
        totalXp,
        level: newLevel,
        xpToNextLevel,
        lastLevelUpAt: levelUps > 0 ? new Date() : null,
      },
    });

    const leveledUp = newLevel > previousLevel;

    if (leveledUp) {
      log.info("Level up", {
        memberId: member.id,
        guildId: input.guildId,
        from: previousLevel,
        to: newLevel,
        levelsGained: levelUps,
      });
    }

    return {
      awarded: amount,
      totalXp,
      previousLevel,
      newLevel,
      leveledUp,
      note:
        amount < input.amount
          ? "Reduced to stay within the daily cap."
          : undefined,
    };
  });
}

/**
 * Recalculate a member's level from their stored total.
 *
 * Only needed when a level curve changes; normal awards compute it inline.
 */
export async function syncMemberLevel(memberId: string): Promise<void> {
  const member = await prisma.guildMember.findUnique({
    where: { id: memberId },
    select: { id: true, guildId: true, xp: true, level: true },
  });

  if (!member) return;

  const level = levelForXp(member.xp);

  if (level === member.level) return;

  await prisma.$transaction([
    prisma.guildMember.update({
      where: { id: member.id },
      data: { level },
    }),
    prisma.memberXP.update({
      where: { memberId: member.id },
      data: {
        level,
        totalXp: member.xp,
        xpToNextLevel: Math.max(xpForLevel(level + 1) - member.xp, 0),
      },
    }),
  ]);

  log.info("Level recalculated", {
    memberId: member.id,
    from: member.level,
    to: level,
  });
}