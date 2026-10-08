import { RewardActionType, XPSource } from "@prisma/client";
import type { GuildMember } from "discord.js";

import {
  addRoleToMember,
  removeRoleFromMember,
} from "@/bot/services/moderation";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { metricValue } from "@/lib/progression/metrics";
import { awardXp } from "@/lib/xp/award-xp";
import { evaluateReward, type RewardInput } from "./evaluate";

/**
 * Executing rewards.
 *
 * Like role rules, granting a role needs the bot's Discord member, so this
 * runs in the bot process rather than inside a web request.
 *
 * Deliberately not marked `server-only` for the same reason: the standalone
 * bot imports it, and that marker throws outside a Next.js bundle.
 */

const log = createLogger("xp");

export interface GrantRewardsResult {
  /** Rewards granted, by name. */
  granted: string[];
  /** Rewards that could not be completed, with the reason. */
  failed: Array<{ reward: string; reason: string }>;
  /** Rewards skipped: not yet earned, already granted, or disabled. */
  skipped: number;
}

export interface GrantInput {
  member: GuildMember;
  guildId: string;
  /** Set when a moderator granted this by hand. */
  manualByDiscordId?: string;
  /** Grant only this reward, for the `/reward` command. */
  onlyRewardId?: string;
}

/**
 * Check every enabled reward for a member and grant what they qualify for.
 */
export async function grantEligibleRewards(
  input: GrantInput,
): Promise<GrantRewardsResult> {
  const result: GrantRewardsResult = { granted: [], failed: [], skipped: 0 };

  const member = await prisma.guildMember.findFirst({
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

  if (!member) return result;

  const rewards = await prisma.reward.findMany({
    where: {
      guildId: input.guildId,
      enabled: true,
      ...(input.onlyRewardId ? { id: input.onlyRewardId } : {}),
    },
    select: {
      id: true,
      name: true,
      enabled: true,
      conditionMetric: true,
      conditionThreshold: true,
      repeatable: true,
      actions: { select: { type: true } },
    },
  });

  if (rewards.length === 0) return result;

  // Existing grants are needed to keep one-shot rewards one-shot.
  const grants = await prisma.rewardGrant.findMany({
    where: {
      guildId: input.guildId,
      memberId: member.id,
      rewardId: { in: rewards.map((reward) => reward.id) },
    },
    select: { rewardId: true, memberId: true },
  });

  const stats = {
    xp: member.xp,
    level: member.level,
    messageCount: member.messageCount,
    streamAttendanceCount: member.streamAttendanceCount,
    watchTimeMinutes: member.watchTimeMinutes,
    joinedAt: member.joinedAt,
  };

  for (const reward of rewards as RewardInput[]) {
    const eligibility = evaluateReward(reward, stats, grants, member.id);

    // A moderator may hand out the same reward twice, but never one the
    // member has not earned. Letting a manual grant bypass "not yet met"
    // would turn /reward into an XP printer.
    const manualOverride =
      input.manualByDiscordId !== undefined &&
      !eligibility.eligible &&
      eligibility.reason === "ALREADY_GRANTED";

    if (!eligibility.eligible && !manualOverride) {
      result.skipped += 1;
      continue;
    }

    const outcome = await grantReward({
      member: input.member,
      guildId: input.guildId,
      memberRowId: member.id,
      rewardId: reward.id,
      rewardName: reward.name,
      // The progress that satisfied the condition, in that condition's own
      // units. Storing total XP for a "streams attended" reward would make
      // the history unreadable.
      progressValue: metricValue(reward.conditionMetric, stats),
      manualByDiscordId: input.manualByDiscordId,
    });

    if (outcome.ok) {
      result.granted.push(reward.name);
      log.info("Reward granted", {
        guildId: input.guildId,
        memberId: member.id,
        reward: reward.name,
        manual: Boolean(input.manualByDiscordId),
      });
    } else {
      result.failed.push({ reward: reward.name, reason: outcome.error });
      log.warn("Reward grant failed", {
        guildId: input.guildId,
        memberId: member.id,
        reward: reward.name,
        reason: outcome.error,
      });
    }
  }

  return result;
}

/**
 * The result of running one reward's actions.
 *
 * A union rather than `{ ok, error? }`, so a failure always carries a
 * reason and callers never have to handle a half-populated result.
 */
type GrantOutcome = { ok: true } | { ok: false; error: string };

/**
 * Run one reward's actions and record the grant.
 *
 * The grant row is written even when an action fails, so a role that cannot
 * be assigned does not cause the same reward to retry on every message.
 * The failure is reported so the creator can fix it.
 */
async function grantReward(input: {
  member: GuildMember;
  guildId: string;
  memberRowId: string;
  rewardId: string;
  rewardName: string;
  progressValue: number;
  manualByDiscordId?: string;
}): Promise<GrantOutcome> {
  const actions = await prisma.rewardAction.findMany({
    where: { rewardId: input.rewardId },
    select: {
      id: true,
      type: true,
      xpAmount: true,
      roleId: true,
      roleName: true,
      achievementId: true,
    },
  });

  const failures: string[] = [];

  for (const action of actions) {
    const outcome = await runAction(action, input);
    if (!outcome.ok) failures.push(outcome.error);
  }

  await prisma.rewardGrant.create({
    data: {
      guildId: input.guildId,
      rewardId: input.rewardId,
      memberId: input.memberRowId,
      progressValue: input.progressValue,
      manualGrantedByDiscordId: input.manualByDiscordId,
    },
  });

  if (failures.length > 0) {
    return { ok: false, error: failures.join("; ") };
  }

  return { ok: true };
}

type ActionInput = {
  id: string;
  type: RewardActionType;
  xpAmount: number | null;
  roleId: string | null;
  roleName: string | null;
  achievementId: string | null;
};

async function runAction(
  action: ActionInput,
  context: {
    member: GuildMember;
    guildId: string;
    memberRowId: string;
    rewardName: string;
  },
): Promise<GrantOutcome> {
  switch (action.type) {
    case RewardActionType.GIVE_XP: {
      if (!action.xpAmount) return { ok: false, error: "XP amount is missing." };

      // Rewards bypass the daily cap: the cap exists to limit grinding from
      // messages, and a creator's reward is a deliberate grant.
      const result = await awardXp({
        guildId: context.guildId,
        memberId: context.memberRowId,
        amount: action.xpAmount,
        source: XPSource.REWARD,
        reason: `Reward: ${context.rewardName}`,
        ignoreDailyCap: true,
      });

      return result.awarded > 0
        ? { ok: true }
        : { ok: false, error: "XP was not awarded." };
    }

    case RewardActionType.ADD_ROLE: {
      if (!action.roleId) return { ok: false, error: "Role is missing." };

      const result = await addRoleToMember(context.member, action.roleId);
      return result.ok
        ? { ok: true }
        : { ok: false, error: `Could not add @${action.roleName ?? "role"}: ${result.error}` };
    }

    case RewardActionType.REMOVE_ROLE: {
      if (!action.roleId) return { ok: false, error: "Role is missing." };

      const result = await removeRoleFromMember(context.member, action.roleId);
      return result.ok
        ? { ok: true }
        : { ok: false, error: `Could not remove @${action.roleName ?? "role"}: ${result.error}` };
    }

    case RewardActionType.UNLOCK_ACHIEVEMENT: {
      if (!action.achievementId) {
        return { ok: false, error: "Achievement is missing." };
      }

      // Already holding the achievement is a success, not a failure: the
      // member ends up unlocked either way.
      await prisma.memberAchievement.createMany({
        data: {
          guildId: context.guildId,
          achievementId: action.achievementId,
          memberId: context.memberRowId,
        },
        skipDuplicates: true,
      });

      return { ok: true };
    }

    default:
      // Giveaway entries have no entity to write to yet. Reported rather
      // than silently ignored, so the creator learns it did nothing.
      return {
        ok: false,
        error: "Giveaway entries are not supported yet.",
      };
  }
}

/** Grants recorded for a member, newest first. */
export async function getRewardHistory(
  guildId: string,
  memberId: string,
  take = 20,
) {
  return prisma.rewardGrant.findMany({
    where: { guildId, memberId },
    select: {
      id: true,
      createdAt: true,
      progressValue: true,
      manualGrantedByDiscordId: true,
      reward: { select: { id: true, name: true, description: true } },
    },
    orderBy: { createdAt: "desc" },
    take,
  });
}