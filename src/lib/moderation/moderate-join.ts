import { ModerationActionType, ModerationActionTypeRecord, ModerationRuleType } from "@prisma/client";
import type { Guild, GuildMember } from "discord.js";

import { sendChannelMessage, timeoutMember } from "@/bot/services/moderation";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { detectSpike } from "@/lib/moderation/rate-limit";
import { recordAction } from "@/lib/moderation/warnings";

/**
 * Anti-raid protection (PRD section 7.11).
 *
 * A raid is a burst of joins. When one is detected, the accounts that joined
 * inside the window are timed out, which stops them posting while a moderator
 * decides what to do.
 *
 * Nothing is banned automatically. A join spike has innocent explanations, and
 * auto-banning is how a protection tool becomes the incident.
 *
 * Deliberately not marked `server-only`: the standalone bot imports this.
 */

const log = createLogger("bot");

/** A join that is still inside the window. */
interface JoinEvent {
  at: number;
  memberId: string;
}

/**
 * Recent joiners per guild, in memory.
 *
 * A guild key holds the events rather than per-member keys, because a raid is
 * counted across all arrivals, and the caller needs the ids to act on.
 */
const recentJoins = new Map<string, JoinEvent[]>();

/** Stop tracking a guild's joiners older than this. */
const MAX_WINDOW_MS = 15 * 60 * 1000;

/** The configured raid rule, or null when the creator has not set one up. */
interface RaidRule {
  id: string;
  name: string;
  joinThreshold: number | null;
  joinWindowSeconds: number | null;
  action: ModerationActionType;
  actionDurationMins: number | null;
  logChannelId: string | null;
}

export interface RaidIncident {
  tripped: boolean;
  /** Accounts timed out as part of this incident. */
  timedOut: number;
  /** Accounts the bot could not time out. */
  failed: number;
  /** The rule that fired, if any. */
  rule?: string;
}

/**
 * Record a join and act if it completes a raid.
 *
 * Never throws, so a failure here cannot stop a member being tracked.
 */
export async function moderateJoin(
  member: GuildMember,
  guildDbId: string,
  now: number = Date.now(),
): Promise<RaidIncident> {
  const incident: RaidIncident = { tripped: false, timedOut: 0, failed: 0 };

  try {
    const rule = await loadRaidRule(guildDbId);

    // With no rule configured there is nothing to detect, and recording joins
    // would grow the map for no reason.
    if (!rule) return incident;

    if (rule.joinThreshold === null || rule.joinWindowSeconds === null) {
      log.warn("Raid rule is missing its threshold or window", { ruleId: rule.id });
      return incident;
    }

    const windowMs = Math.min(rule.joinWindowSeconds * 1000, MAX_WINDOW_MS);
    const events = recordJoin(guildDbId, member.id, now, windowMs);
    const spike = detectSpike(events, { limit: rule.joinThreshold, windowMs }, now);

    if (!spike.tripped) return incident;

    incident.tripped = true;
    incident.rule = rule.name;

    // The accounts to act on are the ones that joined inside the window. The
    // joining member is in that list, so the newest arrival is covered too.
    const minutes = rule.actionDurationMins ?? 30;

    for (const event of spike.events) {
      const outcome = await timeoutJoiner(member.guild, event.memberId, minutes, rule.name);

      if (outcome) {
        incident.timedOut += 1;
      } else {
        incident.failed += 1;
      }
    }

    await recordIncident(guildDbId, member.id, rule, spike.events.length, incident, minutes);

    await notify(rule, member.guild, spike.events.length, incident, minutes);

    log.warn("Raid protection triggered", {
      guildId: member.guild.id,
      rule: rule.name,
      joins: spike.events.length,
      timedOut: incident.timedOut,
      failed: incident.failed,
    });
  } catch (error) {
    log.error("Raid check failed", {
      guildId: member.guild.id,
      memberId: member.id,
      reason: error instanceof Error ? error.message : "unknown",
    });
  }

  return incident;
}

/**
 * Add a join and drop anything now outside the window.
 *
 * Returns the window's events so the caller can count them.
 */
function recordJoin(
  guildDbId: string,
  memberId: string,
  now: number,
  windowMs: number,
): JoinEvent[] {
  const cutoff = now - windowMs;
  const existing = recentJoins.get(guildDbId) ?? [];
  const kept = existing.filter((event) => event.at > cutoff);

  kept.push({ at: now, memberId });

  recentJoins.set(guildDbId, kept);

  return kept;
}

/** Time out one account, reporting whether it worked. */
async function timeoutJoiner(
  guild: Guild,
  memberId: string,
  minutes: number,
  ruleName: string,
): Promise<boolean> {
  // The server owner can always be timed out, but doing it would lock the
  // creator out of their own server during the incident.
  if (memberId === guild.ownerId) return true;

  const target = guild.members.cache.get(memberId);

  // Not in cache means the member left or was never fetched. Either way there
  // is nothing to time out, and it is not a failure worth alarming about.
  if (!target) return false;

  const outcome = await timeoutMember(target, minutes * 60_000, `Raid protection: ${ruleName}`);

  return outcome.ok;
}

async function recordIncident(
  guildDbId: string,
  triggeringMemberId: string,
  rule: RaidRule,
  joinCount: number,
  incident: RaidIncident,
  minutes: number,
): Promise<void> {
  const dbMember = await prisma.guildMember.findFirst({
    where: { guildId: guildDbId, discordId: triggeringMemberId },
    select: { id: true },
  });

  // One record for the incident, against the member whose arrival completed
  // it. There is no incident table, and a row per timed-out account would bury
  // the individual warnings and timeouts already recorded for them.
  if (!dbMember) return;

  await recordAction({
    guildId: guildDbId,
    type: ModerationActionTypeRecord.RAID_TIMEOUT,
    targetMemberId: dbMember.id,
    reason: `${joinCount} joins in ${rule.joinWindowSeconds}s (limit ${rule.joinThreshold}); ${incident.timedOut} timed out for ${minutes}m`,
    durationMins: minutes,
    ruleId: rule.id,
  });
}

/**
 * Post a notice to the rule's log channel.
 *
 * Best effort: a missing permission here must not undo the protection that has
 * already been applied.
 */
async function notify(
  rule: RaidRule,
  guild: Guild,
  joinCount: number,
  incident: RaidIncident,
  minutes: number,
): Promise<void> {
  if (!rule.logChannelId) return;

  const channel = guild.channels.cache.get(rule.logChannelId);

  if (!channel || !channel.isTextBased() || !("send" in channel)) return;

  const outcome = await sendChannelMessage(
    channel,
    `Raid protection triggered by "${rule.name}": ${joinCount} joins. ${incident.timedOut} members timed out for ${minutes}m.`,
  );

  if (!outcome.ok) {
    log.warn("Raid notice could not be sent", {
      channelId: rule.logChannelId,
      ruleId: rule.id,
      code: outcome.code,
    });
  }
}

async function loadRaidRule(guildDbId: string): Promise<RaidRule | null> {
  return prisma.moderationRule.findFirst({
    where: { guildId: guildDbId, enabled: true, type: ModerationRuleType.RAID_PROTECTION },
    select: {
      id: true,
      name: true,
      joinThreshold: true,
      joinWindowSeconds: true,
      action: true,
      actionDurationMins: true,
      logChannelId: true,
    },
  });
}

/** Forget a guild's join history. Used by tests. */
export function resetJoinWindows(guildDbId?: string): void {
  if (guildDbId) {
    recentJoins.delete(guildDbId);
    return;
  }

  recentJoins.clear();
}