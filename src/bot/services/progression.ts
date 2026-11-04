import type { GuildMember } from "discord.js";

import { unlockAchievementsForMember, type UnlockAchievementsResult } from "@/lib/achievements/unlock";
import {
  announceChallengeCompletions,
  type ChallengeAnnouncementResult,
} from "@/lib/challenges/announce-completion";
import {
  grantChallengeCompletions,
  type GrantCompletionsResult,
} from "@/lib/challenges/grant-completion";
import {
  updateChallengeProgress,
  type ChallengeActivity,
  type UpdateChallengesResult,
} from "@/lib/challenges/record-progress";
import { observeOperation } from "@/lib/monitoring/health";

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { applyRoleRulesForMember, type ApplyRolesResult } from "@/lib/roles/apply-rules";
import { grantEligibleRewards, type GrantRewardsResult } from "@/lib/rewards/grant";

/**
 * One place that reacts to a member's progress changing.
 *
 * Roles, rewards, challenges and achievements are all "condition -> effect"
 * over the same numbers, so they are checked together after the same events:
 * a message, a stream attendance reaction, and a member joining. Having one
 * entry point is what keeps a new event from wiring up one system and
 * forgetting the others.
 *
 * Nothing here throws. A role above the bot's highest role is a configuration
 * problem to report, not a reason to drop a member's XP or their other
 * rewards.
 */

const log = createLogger("bot");

export interface ProgressionResult {
  roles: ApplyRolesResult;
  rewards: GrantRewardsResult;
  challenges: UpdateChallengesResult & {
    payouts: GrantCompletionsResult;
    announcements: ChallengeAnnouncementResult;
  };
  achievements: UnlockAchievementsResult;
}

export interface ProgressionOptions {
  /** Set when a moderator granted a reward by hand. */
  manualByDiscordId?: string;
  /** Check only this reward, used by the `/reward` command. */
  onlyRewardId?: string;
  /**
   * What the member just did.
   *
   * Required, because challenge progress is counted per activity. Without it a
   * message and a stream attendance would be indistinguishable, and a
   * challenge would be unable to tell which counter to advance.
   */
  activity: ChallengeActivity;
}

/** Apply roles, rewards and challenges for a member. */
export async function applyProgressionForMember(
  member: GuildMember,
  guildDbId: string,
  options: ProgressionOptions,
): Promise<ProgressionResult> {
  const dbMember = await observeOperation("database.progression", "postgres", () => prisma.guildMember.findFirst({
    where: { guildId: guildDbId, discordId: member.id },
    select: { id: true, level: true },
  }));

  // Nothing is tracked for this member yet, so nothing can be measured.
  if (!dbMember) {
    const empty = { updated: [], completed: [], expired: 0, skippedNoRequirements: 0, unrelated: 0 };
    return {
      roles: { assigned: [], failed: [], alreadyHeld: 0, unsatisfied: 0 },
      rewards: { granted: [], failed: [], skipped: 0 },
      challenges: {
        ...empty,
        payouts: { granted: [], partial: [], alreadyGiven: 0 },
        announcements: {
          announced: [],
          failed: [],
          skippedNoChannel: 0,
          skippedDuplicate: 0,
        },
      },
      achievements: { unlocked: [], partial: [], skipped: 0 },
    };
  }

  const roles = await observeOperation("job.roles", "job", () => applyRoleRulesForMember(member, guildDbId),
    value => value.failed.length ? "JOB_PARTIAL" : value.assigned.length ? "success" : "skipped");

  const rewards = await observeOperation("job.rewards", "job", () => grantEligibleRewards({
    member,
    guildId: guildDbId,
    ...(options.manualByDiscordId ? { manualByDiscordId: options.manualByDiscordId } : {}),
    ...(options.onlyRewardId ? { onlyRewardId: options.onlyRewardId } : {}),
  }), value => value.failed.length ? "JOB_PARTIAL" : value.granted.length ? "success" : "skipped");

  // Challenges run after rewards: a reward's XP can push a member over a level
  // threshold, and the challenge should see the level it just produced rather
  // than the one from before.
  const challengeProgress = await observeOperation("job.challenge-progress", "job", () => updateChallengeProgress({
    guildId: guildDbId,
    memberId: dbMember.id,
    level: dbMember.level,
    activity: options.activity,
  }), value => value.updated.length || value.completed.length ? "success" : "skipped");

  const payouts = await observeOperation("job.challenge-payout", "job", () => grantChallengeCompletions({ member, guildId: guildDbId }),
    value => value.partial.length ? "JOB_PARTIAL" : value.granted.length ? "success" : "skipped");

  // Announcements are a side effect of progression, not part of it. Keep any
  // unexpected failure here from skipping achievements or disturbing the
  // already-committed reward payout flow above.
  let announcements: ChallengeAnnouncementResult;

  try {
    announcements = await observeOperation("job.challenge-announcement", "job", () => announceChallengeCompletions({
      member,
      guildId: guildDbId,
    }), value => value.failed.length ? "JOB_PARTIAL" : value.announced.length ? "success" : "skipped");
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Unknown announcement error";
    announcements = {
      announced: [],
      failed: [{ challenge: "announcement check", reason }],
      skippedNoChannel: 0,
      skippedDuplicate: 0,
    };
    log.error("Challenge announcement check failed", {
      guildId: guildDbId,
      memberId: member.id,
      reason,
    });
  }

  // Achievements run last: they read lifetime totals, so they should see
  // anything the rewards and challenges just added rather than the values
  // from before.
  const achievements = await observeOperation("job.achievements", "job", () => unlockAchievementsForMember({ member, guildId: guildDbId }),
    value => value.partial.length ? "JOB_PARTIAL" : value.unlocked.length ? "success" : "skipped");

  return {
    roles,
    rewards,
    challenges: { ...challengeProgress, payouts, announcements },
    achievements,
  };
}

/**
 * The same as `applyProgressionForMember`, but never throws.
 *
 * Event handlers call this so one failing subsystem cannot stop the others or
 * bubble up into the gateway's error handler.
 */
export async function tryApplyProgression(
  member: GuildMember,
  guildDbId: string,
  options: ProgressionOptions,
): Promise<ProgressionResult | null> {
  try {
    return await observeOperation("job.progression", "job", () => applyProgressionForMember(member, guildDbId, options),
      value => value.roles.failed.length || value.rewards.failed.length || value.challenges.payouts.partial.length ||
        value.challenges.announcements.failed.length || value.achievements.partial.length ? "JOB_PARTIAL" : "success");
  } catch (error) {
    log.error("Progression check failed", {
      guildId: member.guild.id,
      memberId: member.id,
      reason: error instanceof Error ? error.message : "unknown",
    });

    return null;
  }
}