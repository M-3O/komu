import type { GuildMember } from "discord.js";

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { addRoleToMember } from "@/bot/services/moderation";
import {
  describeRule,
  evaluateRules,
  type MemberStats,
  type RoleRuleInput,
} from "./evaluate-rules";

/**
 * Applying role rules.
 *
 * Called after activity that could change a member's standing (XP, messages,
 * joining). Every Discord failure is reported rather than thrown, because a
 * role above the bot's highest role is a configuration problem, not a crash.
 */

const log = createLogger("bot");

export interface ApplyRolesResult {
  /** Roles successfully added. */
  assigned: string[];
  /** Rules that failed, with the reason to show a creator. */
  failed: Array<{ rule: string; reason: string }>;
  /** Rules skipped because the member already had the role. */
  alreadyHeld: number;
  /** Rules skipped because the member does not qualify yet. */
  unsatisfied: number;
}

/** Read the numbers role rules are measured against. */
export async function loadMemberStats(
  memberId: string,
): Promise<MemberStats | null> {
  const member = await prisma.guildMember.findUnique({
    where: { id: memberId },
    select: {
      xp: true,
      level: true,
      messageCount: true,
      streamAttendanceCount: true,
      watchTimeMinutes: true,
      joinedAt: true,
    },
  });

  return member;
}

/** Every enabled rule for a guild. */
export async function loadGuildRules(
  guildId: string,
): Promise<RoleRuleInput[]> {
  const rules = await prisma.roleRule.findMany({
    where: { guildId, enabled: true },
    select: {
      id: true,
      name: true,
      metric: true,
      threshold: true,
      roleId: true,
      roleName: true,
    },
    orderBy: { threshold: "asc" },
  });

  return rules;
}

/**
 * Check every rule for a Discord member and assign the roles they qualify for.
 */
export async function applyRoleRulesForMember(
  discordMember: GuildMember,
  guildDbId: string,
): Promise<ApplyRolesResult> {
  const result: ApplyRolesResult = {
    assigned: [],
    failed: [],
    alreadyHeld: 0,
    unsatisfied: 0,
  };

  const dbMember = await prisma.guildMember.findFirst({
    where: { guildId: guildDbId, discordId: discordMember.id },
    select: { id: true },
  });

  if (!dbMember) {
    // The member has not been seen yet; nothing to measure.
    return result;
  }

  const [stats, rules] = await Promise.all([
    loadMemberStats(dbMember.id),
    loadGuildRules(guildDbId),
  ]);

  if (!stats || rules.length === 0) return result;

  const evaluation = evaluateRules(
    rules,
    stats,
    [...discordMember.roles.cache.keys()],
  );

  result.alreadyHeld = evaluation.alreadyHeld.length;
  result.unsatisfied = evaluation.unsatisfied.length;

  for (const rule of evaluation.toAssign) {
    const outcome = await addRoleToMember(discordMember, rule.roleId);

    if (outcome.ok) {
      result.assigned.push(rule.roleName);
      log.info("Assigned role from rule", {
        guildId: discordMember.guild.id,
        memberId: discordMember.id,
        rule: describeRule(rule),
      });
      continue;
    }

    // Recorded so a creator can see why the role never appeared, rather than
    // the bot failing silently on every message.
    result.failed.push({
      rule: describeRule(rule),
      reason: outcome.error ?? "Could not assign the role.",
    });

    log.warn("Role assignment failed", {
      guildId: discordMember.guild.id,
      memberId: discordMember.id,
      rule: describeRule(rule),
      code: outcome.code,
      reason: outcome.error,
    });
  }

  return result;
}