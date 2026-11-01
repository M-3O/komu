import { Prisma, XPSource } from "@prisma/client";
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
  /** Challenges whose database payout or external role attempt failed. */
  partial: Array<{ challenge: string; reason: string }>;
  /** Challenges skipped because they were already paid. */
  alreadyGiven: number;
}

/**
 * Pay out every challenge the member has completed but not yet been paid for.
 *
 * The completion row is locked until XP and `rewardGivenAt` commit together.
 * A concurrent reader must recheck the unpaid predicate after waiting for the
 * lock, and a rollback leaves the completion unpaid and eligible for retry.
 * Discord role calls happen only after commit, never while holding DB locks.
 * As before, a failed role attempt is reported rather than replaying rewards.
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
    let paid: boolean;

    try {
      paid = await prisma.$transaction(async (tx) => {
        // The initial findMany is only a candidate list. PostgreSQL locks the
        // row and re-evaluates this predicate after a concurrent owner commits.
        const unpaid = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM challenge_progress
          WHERE id = ${row.id}
            AND "guildId" = ${input.guildId}
            AND "memberId" = ${memberRow.id}
            AND "completedAt" IS NOT NULL
            AND "rewardGivenAt" IS NULL
          FOR UPDATE
        `;

        if (unpaid.length === 0) return false;

        if (challenge.xpReward > 0) {
          // Reuse the XP service on this transaction: the ledger, both cached
          // totals and payout marker must all commit or all roll back.
          const outcome = await awardXp({
            guildId: input.guildId,
            memberId: memberRow.id,
            amount: challenge.xpReward,
            source: XPSource.CHALLENGE,
            reason: `Challenge complete: ${challenge.name}`,
            ignoreDailyCap: true,
          }, tx);

          if (outcome.awarded !== challenge.xpReward) {
            throw new Error("Challenge XP was not awarded in full.");
          }
        }

        const marked = await tx.challengeProgress.updateMany({
          where: {
            id: row.id,
            guildId: input.guildId,
            memberId: memberRow.id,
            completedAt: { not: null },
            rewardGivenAt: null,
          },
          data: { rewardGivenAt: new Date() },
        });

        if (marked.count !== 1) {
          throw new Error("Challenge payout could not be recorded.");
        }

        return true;
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10_000,
        timeout: 15_000,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown payout error";
      result.partial.push({ challenge: challenge.name, reason });
      log.warn("Challenge payout transaction failed; safe to retry", {
        guildId: input.guildId,
        memberId: memberRow.id,
        challenge: challenge.name,
        reason,
      });
      continue;
    }

    if (!paid) {
      result.alreadyGiven += 1;
      continue;
    }

    // The DB commit is already durable. External role assignment is best
    // effort, as before; a crash here requires role reconciliation, not an XP
    // replay. Do not move Discord work inside the transaction above.
    if (challenge.rewardRoleId) {
      try {
        const outcome = await addRoleToMember(input.member, challenge.rewardRoleId);

        if (!outcome.ok) {
          problems.push(
            `Could not add @${challenge.rewardRoleName ?? "role"}: ${outcome.error ?? "unknown"}`,
          );
        }
      } catch {
        problems.push(`Could not add @${challenge.rewardRoleName ?? "role"}.`);
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
  }

  return result;
}
