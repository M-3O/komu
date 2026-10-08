import type { GuildMember } from "discord.js";

import { createLogger } from "@/lib/logger";
import { applyRoleRulesForMember, type ApplyRolesResult } from "@/lib/roles/apply-rules";
import { grantEligibleRewards, type GrantRewardsResult } from "@/lib/rewards/grant";

/**
 * One place that reacts to a member's progress changing.
 *
 * Roles and rewards are both "condition -> effect" over the same numbers, so
 * they are checked together after the same events: a message, a stream
 * attendance reaction, and a member joining. Having one entry point is what
 * keeps a new event from wiring up one system and forgetting the other.
 *
 * Neither call throws: a role above the bot's highest role is a configuration
 * problem to report, not a reason to drop a member's other rewards.
 */

const log = createLogger("bot");

export interface ProgressionResult {
  roles: ApplyRolesResult;
  rewards: GrantRewardsResult;
}

export interface ProgressionOptions {
  /** Set when a moderator granted a reward by hand. */
  manualByDiscordId?: string;
  /** Check only this reward, used by the `/reward` command. */
  onlyRewardId?: string;
}

/** Apply role rules and rewards for a member. */
export async function applyProgressionForMember(
  member: GuildMember,
  guildDbId: string,
  options: ProgressionOptions = {},
): Promise<ProgressionResult> {
  const roles = await applyRoleRulesForMember(member, guildDbId);

  const rewards = await grantEligibleRewards({
    member,
    guildId: guildDbId,
    ...options,
  });

  return { roles, rewards };
}

/**
 * The same as `applyProgressionForMember`, but never throws.
 *
 * Event handlers call this so one failing subsystem cannot stop the other or
 * bubble up into the gateway's error handler.
 */
export async function tryApplyProgression(
  member: GuildMember,
  guildDbId: string,
  options: ProgressionOptions = {},
): Promise<ProgressionResult | null> {
  try {
    return await applyProgressionForMember(member, guildDbId, options);
  } catch (error) {
    log.error("Progression check failed", {
      guildId: member.guild.id,
      memberId: member.id,
      reason: error instanceof Error ? error.message : "unknown",
    });

    return null;
  }
}