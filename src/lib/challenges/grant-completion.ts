import { XPSource } from "@prisma/client";
import type { GuildMember } from "discord.js";

import { addRoleToMember } from "@/bot/services/moderation";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { awardXp } from "@/lib/xp/award-xp";

/**
 * Granting what a completed challenge pays out.
 *
 * Separate from recording progress because this needs the bot's Discord
 * member to assign a role, so it runs in the bot process rather than inside a
 * web request.
 *
 * Deliberately not marked `server-only` for the same reason: the standalone
 * bot imports this, and that marker throws outside a Next.js server bundle.
 */

const log = createLogger("xp");

export interface GrantCompletionsResult {
  /** Challenges whose payout fully succeeded. */
  granted: string[];
  /** Challenges partly paid out, with the reason. */
  partial: Array<{ challenge: string; reason: string }>;
  /** Challenges skipped because they were already paid. */
  alreadyGiven: number;
}

/**
 * Pay out every challenge the member has completed but not yet been paid for.
 *
 * Safe to call repeatedly. The `rewardGivenAt` check is what stops a member
 * collecting the same challenge reward on every message afterwards.
 */
export async function grantChallengeCompletions(input: {
  member: GuildMember;
  guildId: string;
  /** Restrict to one challenge, for the manual path. */
  onlyChallengeId?: string;
}): Promise<GrantCompletionsResult> {
  const result: GrantCompletionsResult = { granted: [], partial: [], alreadyGiven: 0 };

  // `member.id` is a Discord snowflake, while ChallengeProgress and XP are
  // keyed by the database member row. Looking the row up here is what keeps
  // the two ids from being confused.
  const memberRow = await prisma.guildMember.findFirst({
    where: { guildId: input.guildId, discordId: input.member.id },
    select: { id: true },
  });

  if (!memberRow) return result;

  const progressRows = await prisma.challengeProgress.findMany({
    where: {
      guildId: input.guildId,
      memberId: memberRow.id,
      // Null completedAt means never completed. An explicit condition rather
      // than a truthiness check, so it does not quietly change meaning.
      completedAt: { not: null },
      rewardGivenAt: null,
      ...(input.onlyChallengeId ? { challengeId: input.onlyChallengeId } : {}),
    },
    select: {
      id: true,
      challengeId: true,
      challenge: {
        select: {
          name: true,
          xpReward: true,
          rewardRoleId: true,
          rewardRoleName: true,
        },
      },
    },
  });

  for (const row of progressRows) {
    const { challenge } = row;
    const problems: string[] = [];

    if (challenge.xpReward > 0) {
      // Bypasses the daily cap: a challenge the member finished is a
      // deliberate payout, not something earned by grinding messages.
      const outcome = await awardXp({
        guildId: input.guildId,
        memberId: memberRow.id,
        amount: challenge.xpReward,
        source: XPSource.CHALLENGE,
        reason: `Challenge complete: ${challenge.name}`,
        ignoreDailyCap: true,
      });

      if (outcome.awarded <= 0) {
        problems.push("XP was not awarded.");
      }
    }

    if (challenge.rewardRoleId) {
      const outcome = await addRoleToMember(input.member, challenge.rewardRoleId);

      if (!outcome.ok) {
        problems.push(
          `Could not add @${challenge.rewardRoleName ?? "role"}: ${outcome.error ?? "unknown"}`,
        );
      }
    }

    if (problems.length === 0) {
      result.granted.push(challenge.name);
      log.info("Challenge reward granted", {
        guildId: input.guildId,
        memberId: memberRow.id,
        challenge: challenge.name,
      });
    } else {
      result.partial.push({ challenge: challenge.name, reason: problems.join("; ") });

      log.warn("Challenge reward partly granted", {
        guildId: input.guildId,
        memberId: memberRow.id,
        challenge: challenge.name,
        reason: problems.join("; "),
      });
    }

    // Marked as paid even on a partial failure, so a role that cannot be
    // assigned does not retry on every message. The XP did land, and
    // repeatedly retrying would inflate totals.
    await prisma.challengeProgress.updateMany({
      where: { id: row.id, rewardGivenAt: null },
      data: { rewardGivenAt: new Date() },
    });
  }

  return result;
}