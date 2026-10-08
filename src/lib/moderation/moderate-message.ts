import { ModerationActionType, ModerationActionTypeRecord, ModerationRuleType } from "@prisma/client";
import type { Message } from "discord.js";

import {
  deleteMessage,
  sendChannelMessage,
  timeoutMember,
} from "@/bot/services/moderation";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import {
  exceeded,
  messageKey,
  SlidingWindow,
} from "@/lib/moderation/rate-limit";
import { findBlockedWord } from "@/lib/moderation/word-filter";
import { recordAction, warnMember } from "@/lib/moderation/warnings";

/**
 * Automatic moderation of messages (PRD section 7.11).
 *
 * Runs before XP is awarded. A message that gets deleted must not also earn
 * XP, or a spammer is rewarded for flooding, which is the opposite of the
 * point of the filter.
 *
 * Deliberately not marked `server-only`: the standalone bot imports this.
 */

const log = createLogger("bot");

/**
 * Recent event timestamps, in memory.
 *
 * Process-wide rather than per call, because the window has to survive between
 * messages. It resets on restart, which for a rate limiter means a brief lapse
 * after a deploy rather than a way past it.
 */
const recent = new SlidingWindow();

/** Drop stale keys so the map does not grow without bound. */
const PRUNE_AFTER_MS = 15 * 60 * 1000;
let lastPrune = 0;

/** A rule as stored, or as configured. */
interface Rule {
  id: string;
  name: string;
  type: ModerationRuleType;
  action: ModerationActionType;
  actionDurationMins: number | null;
  blockedWords: string[];
  warnOnMatch: boolean;
  messageLimit: number | null;
  windowSeconds: number | null;
  logChannelId: string | null;
}

export interface ModeratedMessage {
  /** Something happened that a moderator should know about. */
  actioned: boolean;
  /**
   * The message was deleted.
   *
   * The caller must not award XP for a deleted message.
   */
  deleted: boolean;
  /** Rules that fired, for logging. */
  triggered: Array<{ rule: string; type: string; matched?: string }>;
  /** Notices that could not be delivered. */
  noticeFailed: boolean;
}

/**
 * Apply the word filter and spam rules to a message.
 *
 * Never throws: a failed moderation action must not take the gateway handler
 * down with it.
 */
export async function moderateMessage(
  message: Message,
  guildDbId: string,
  now: number = Date.now(),
): Promise<ModeratedMessage> {
  const result: ModeratedMessage = {
    actioned: false,
    deleted: false,
    triggered: [],
    noticeFailed: false,
  };

  try {
    const rules = await loadRules(guildDbId);

    if (rules.length === 0) return result;

    maybePrune(now);

    const discordMember = message.member;

    // A rule with no database row to attach the action to cannot be recorded,
    // so only tracked members are moderated.
    const dbMember = discordMember
      ? await prisma.guildMember.findFirst({
          where: { guildId: guildDbId, discordId: discordMember.id },
          select: { id: true },
        })
      : null;

    if (!dbMember) return result;

    for (const rule of rules) {
      if (rule.type === ModerationRuleType.WORD_FILTER) {
        await applyWordFilter(rule, message, dbMember.id, guildDbId, result);
        continue;
      }

      if (rule.type === ModerationRuleType.SPAM) {
        await applySpam(rule, message, dbMember.id, guildDbId, result, now);
      }
    }

    return result;
  } catch (error) {
    log.error("Message moderation failed", {
      guildId: message.guildId,
      userId: message.author.id,
      reason: error instanceof Error ? error.message : "unknown",
    });

    return result;
  }
}

async function loadRules(guildDbId: string): Promise<Rule[]> {
  return prisma.moderationRule.findMany({
    where: { guildId: guildDbId, enabled: true },
    select: {
      id: true,
      name: true,
      type: true,
      action: true,
      actionDurationMins: true,
      blockedWords: true,
      warnOnMatch: true,
      messageLimit: true,
      windowSeconds: true,
      logChannelId: true,
    },
  });
}

function maybePrune(now: number): void {
  if (now - lastPrune < PRUNE_AFTER_MS) return;

  recent.prune(now, PRUNE_AFTER_MS);
  lastPrune = now;
}

async function applyWordFilter(
  rule: Rule,
  message: Message,
  memberId: string,
  guildDbId: string,
  result: ModeratedMessage,
): Promise<void> {
  // An empty word list would match nothing, but checking first saves building
  // a regex per rule per message.
  if (rule.blockedWords.length === 0) return;

  const matched = findBlockedWord(message.content, rule.blockedWords);

  if (!matched) return;

  result.actioned = true;
  result.triggered.push({ rule: rule.name, type: rule.type, matched });

  if (rule.action === ModerationActionType.DELETE_MESSAGE) {
    const outcome = await deleteMessage(message);

    if (outcome.ok) result.deleted = true;
  }

  await recordAction({
    guildId: guildDbId,
    type: ModerationActionTypeRecord.WORD_FILTER_DELETE,
    targetMemberId: memberId,
    reason: `Matched a blocked word in "${rule.name}"`,
    ruleId: rule.id,
  });

  // The warning is separate from the deletion, so a rule can delete without
  // warning and a creator can choose which.
  if (rule.warnOnMatch) {
    await warnMember({
      guildId: guildDbId,
      memberId,
      moderatorDiscordId: "SYSTEM",
      reason: `Blocked word in "${rule.name}"`,
    });
  }

  await notify(rule, message, `Deleted a message matching "${rule.name}".`);

  log.info("Word filter matched", {
    guildId: message.guildId,
    userId: message.author.id,
    rule: rule.name,
    action: rule.action,
  });
}

async function applySpam(
  rule: Rule,
  message: Message,
  memberId: string,
  guildDbId: string,
  result: ModeratedMessage,
  now: number,
): Promise<void> {
  // A rule missing either number cannot be evaluated. Skipped rather than
  // defaulted, because defaulting would time out everyone.
  if (rule.messageLimit === null || rule.windowSeconds === null) {
    log.warn("Spam rule is missing its limit or window", { ruleId: rule.id });
    return;
  }

  const windowMs = rule.windowSeconds * 1000;
  const key = messageKey(message.guildId ?? "", message.author.id);

  recent.record(key, now, windowMs);

  const count = recent.count(key, now, windowMs);

  if (!exceeded({ limit: rule.messageLimit, windowMs }, count)) return;

  result.actioned = true;
  result.triggered.push({ rule: rule.name, type: rule.type });

  const minutes = rule.actionDurationMins ?? 10;
  const discordMember = message.member;

  if (discordMember) {
    const outcome = await timeoutMember(discordMember, minutes * 60_000, `Spam: ${rule.name}`);

    if (outcome.ok) {
      // Their window is dropped, so a member who is already timed out does not
      // get timed out again by messages queued behind it.
      recent.clear(key);
    }
  }

  await recordAction({
    guildId: guildDbId,
    type: ModerationActionTypeRecord.SPAM_TIMEOUT,
    targetMemberId: memberId,
    reason: `${count} messages in ${rule.windowSeconds}s (limit ${rule.messageLimit})`,
    durationMins: minutes,
    ruleId: rule.id,
  });

  await notify(
    rule,
    message,
    `Timed out ${message.author.username} for ${minutes}m: ${count} messages in ${rule.windowSeconds}s.`,
  );

  log.info("Spam rule matched", {
    guildId: message.guildId,
    userId: message.author.id,
    rule: rule.name,
    count,
    limit: rule.messageLimit,
  });
}

/**
 * Post a notice to the rule's log channel.
 *
 * Best effort. A missing permission here must not fail the moderation that has
 * already happened.
 */
async function notify(rule: Rule, message: Message, text: string): Promise<void> {
  if (!rule.logChannelId) return;

  const channel = message.guild?.channels.cache.get(rule.logChannelId);

  if (!channel || !channel.isTextBased() || !("send" in channel)) return;

  const outcome = await sendChannelMessage(channel, text);

  if (!outcome.ok) {
    log.warn("Moderation notice could not be sent", {
      channelId: rule.logChannelId,
      ruleId: rule.id,
      code: outcome.code,
    });
  }
}

/** Reset the in-memory windows. Used by tests. */
export function resetRateWindows(): void {
  recent.clearAll();
  lastPrune = 0;
}