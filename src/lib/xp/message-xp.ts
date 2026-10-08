import { XPSource } from "@prisma/client";

import { prisma } from "@/lib/db";

/**
 * Deliberately not marked `server-only`: the standalone bot process imports
 * this, and `server-only` throws outside a Next.js server bundle.
 */
import { createLogger } from "@/lib/logger";
import { awardXp, type AwardXpResult } from "./award-xp";

/**
 * XP for Discord messages, including the anti-abuse rules.
 *
 * PRD section 7.5 asks for a cooldown, ignoring repeated messages, and basic
 * per-member limits. The rules are pure functions in this module so each one
 * can be tested without a database, and a single `handleMessageActivity`
 * applies them for the bot.
 */

const log = createLogger("xp");

/** How many identical messages in a row stop earning XP. */
export const REPEAT_ALLOWANCE = 2;

// ---------------------------------------------------------------------------
// Rules (pure)
// ---------------------------------------------------------------------------

/** Why a message earned no XP. Used for logging, not shown to members. */
export type XPDenialReason =
  | "XP_DISABLED"
  | "TOO_SHORT"
  | "ON_COOLDOWN"
  | "REPEATED"
  | "DAILY_CAP";

export interface EligibilityInput {
  /** Guild XP settings. */
  xpEnabled: boolean;
  xpMessageMinLength: number;
  xpMessageCooldownSecs: number;
  message: string;
  /** Timestamp of this member's last XP-granting message. */
  lastXpMessageAt: Date | null;
  /** Hash of the member's previous message. */
  lastMessageHash: string | null;
  /** How many times in a row the previous message was repeated. */
  lastMessageRepeatCount: number;
  now?: Date;
}

export type Eligibility =
  | { eligible: true }
  | { eligible: false; reason: XPDenialReason };

/** Is this message long enough to count? */
export function meetsMinimumLength(
  message: string,
  minimum: number,
): boolean {
  // Trim first: "   lol   " should count as 3 characters, not 9.
  return message.trim().length >= Math.max(minimum, 1);
}

/** Has enough time passed since the member's last XP message? */
export function cooldownElapsed(
  lastXpMessageAt: Date | null,
  cooldownSeconds: number,
  now: Date = new Date(),
): boolean {
  // No cooldown configured, or nothing awarded yet.
  if (cooldownSeconds <= 0 || !lastXpMessageAt) return true;

  const elapsedSeconds = (now.getTime() - lastXpMessageAt.getTime()) / 1000;
  return elapsedSeconds >= cooldownSeconds;
}

/**
 * Has the member already repeated this exact message too many times?
 *
 * Allow the first couple of repeats (people do double-send), then stop.
 */
export function isExcessiveRepeat(
  messageHash: string,
  lastMessageHash: string | null,
  lastMessageRepeatCount: number,
  allowance: number = REPEAT_ALLOWANCE,
): boolean {
  if (lastMessageHash === null) return false;
  if (lastMessageHash !== messageHash) return false;

  // count is the number of times the previous message had already repeated,
  // so a count equal to the allowance means this would be repeat N+1.
  return lastMessageRepeatCount >= allowance;
}

/** Apply every rule and report the first failure. */
export function evaluateEligibility(
  input: EligibilityInput,
): Eligibility {
  if (!input.xpEnabled) return { eligible: false, reason: "XP_DISABLED" };

  if (!meetsMinimumLength(input.message, input.xpMessageMinLength)) {
    return { eligible: false, reason: "TOO_SHORT" };
  }

  const messageHash = hashMessage(input.message);

  if (
    isExcessiveRepeat(
      messageHash,
      input.lastMessageHash,
      input.lastMessageRepeatCount,
    )
  ) {
    return { eligible: false, reason: "REPEATED" };
  }

  if (
    !cooldownElapsed(input.lastXpMessageAt, input.xpMessageCooldownSecs)
  ) {
    return { eligible: false, reason: "ON_COOLDOWN" };
  }

  return { eligible: true };
}

/**
 * Hash a message for repeat detection.
 *
 * Message text is not stored. A short hash is enough to notice that two
 * messages are byte-identical, and it keeps Discord content out of the
 * database.
 */
export function hashMessage(message: string): string {
  const normalised = message.trim().toLowerCase().replace(/\s+/g, " ");

  // FNV-1a: small, fast, and good enough for equality checks. Not a security
  // primitive, so no key is involved.
  let hash = 0x811c9dc5;

  for (let index = 0; index < normalised.length; index++) {
    hash ^= normalised.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Applying it
// ---------------------------------------------------------------------------

export interface MessageActivityInput {
  guildId: string;
  guildDiscordId: string;
  discordUserId: string;
  username: string;
  message: string;
  /** Set when the member has a nickname. */
  nickname?: string | null;
}

export interface MessageActivityResult {
  /** Always true: the activity was recorded even if no XP was awarded. */
  recorded: boolean;
  xp?: AwardXpResult;
  denial?: XPDenialReason;
}

/**
 * Record a member's message activity and award XP when it qualifies.
 *
 * `messageCount` is incremented regardless, because activity is worth
 * tracking even when the XP rules say no.
 */
export async function handleMessageActivity(
  input: MessageActivityInput,
): Promise<MessageActivityResult> {
  const guild = await prisma.guild.findUnique({
    where: { id: input.guildId },
    select: {
      xpEnabled: true,
      xpMessageAmount: true,
      xpMessageMinLength: true,
      xpMessageCooldownSecs: true,
    },
  });

  if (!guild) return { recorded: false };

  const member = await prisma.guildMember.upsert({
    where: {
      guildId_discordId: {
        guildId: input.guildId,
        discordId: input.discordUserId,
      },
    },
    update: {
      messageCount: { increment: 1 },
      username: input.username,
      nickname: input.nickname ?? undefined,
    },
    create: {
      guildId: input.guildId,
      discordId: input.discordUserId,
      username: input.username,
      nickname: input.nickname ?? null,
      messageCount: 1,
    },
    select: {
      id: true,
      lastXpMessageAt: true,
      lastMessageHash: true,
      lastMessageRepeatCount: true,
    },
  });

  const messageHash = hashMessage(input.message);
  const sameAsLast = member.lastMessageHash === messageHash;

  const eligibility = evaluateEligibility({
    xpEnabled: guild.xpEnabled,
    xpMessageMinLength: guild.xpMessageMinLength,
    xpMessageCooldownSecs: guild.xpMessageCooldownSecs,
    message: input.message,
    lastXpMessageAt: member.lastXpMessageAt,
    lastMessageHash: member.lastMessageHash,
    lastMessageRepeatCount: member.lastMessageRepeatCount,
  });

  // Track the repeat counter even when no XP is awarded, otherwise "lol lol
  // lol" would keep resetting to zero and never trip the allowance.
  await prisma.guildMember.update({
    where: { id: member.id },
    data: {
      lastMessageHash: messageHash,
      lastMessageRepeatCount: sameAsLast
        ? member.lastMessageRepeatCount + 1
        : 1,
    },
  });

  if (!eligibility.eligible) {
    return { recorded: true, denial: eligibility.reason };
  }

  const result = await awardXp({
    guildId: input.guildId,
    memberId: member.id,
    amount: guild.xpMessageAmount,
    source: XPSource.MESSAGE,
    reason: "Message activity",
  });

  // Only stamp the cooldown when XP was actually granted, so a denied
  // message does not push the next eligible one further out.
  if (result.awarded > 0) {
    await prisma.guildMember.update({
      where: { id: member.id },
      data: { lastXpMessageAt: new Date() },
    });
  }

  if (result.note) {
    log.info("Award adjusted", {
      memberId: member.id,
      note: result.note,
    });
  }

  return { recorded: true, xp: result, denial: result.awarded > 0 ? undefined : "DAILY_CAP" };
}