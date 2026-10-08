"use server";

import { ModerationActionType, ModerationRuleType } from "@prisma/client";

import { requireCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { listGuildChannels } from "@/lib/discord/rest";
import { createLogger } from "@/lib/logger";
import { ACTIONS_FOR_TYPE } from "@/lib/moderation/rule-config";
import { parseWordList } from "@/lib/moderation/word-filter";

/**
 * Moderation rule CRUD (PRD section 7.11).
 *
 * Each rule type reads a different set of numbers. Rather than defaulting a
 * missing one, a rule missing the numbers it needs is rejected: defaulting
 * would let a half-filled spam rule time out every member.
 */

const log = createLogger("bot");

export interface ModerationFormState {
  ok?: boolean;
  error?: string;
}

export const INITIAL_MODERATION_STATE: ModerationFormState = {};

async function requireGuild() {
  await requireCurrentUser("/dashboard/moderation");

  const guild = await prisma.guild.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, discordId: true },
  });

  if (!guild) throw new Error("No Discord server is connected yet.");

  return guild;
}

function isRuleType(value: string): value is ModerationRuleType {
  return (["WORD_FILTER", "SPAM", "RAID_PROTECTION"] as string[]).includes(value);
}

function isActionType(value: string): value is ModerationActionType {
  const allowed: string[] = ["DELETE_MESSAGE", "WARN", "TIMEOUT", "KICK", "BAN"];

  return allowed.includes(value);
}

/** Parse a positive integer from the form. */
function positiveInt(raw: FormDataEntryValue | null): number | null {
  const parsed = Number.parseInt(String(raw ?? ""), 10);

  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  return parsed;
}

export async function createModerationRuleAction(
  _previous: ModerationFormState,
  formData: FormData,
): Promise<ModerationFormState> {
  const guild = await requireGuild();

  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "");
  const action = String(formData.get("action") ?? "");
  const logChannelId = String(formData.get("logChannelId") ?? "");
  const durationRaw = String(formData.get("actionDurationMins") ?? "");

  if (!name) return { ok: false, error: "Give the rule a name." };

  if (!isRuleType(type)) {
    return { ok: false, error: "Choose what the rule watches for." };
  }

  if (!isActionType(action)) {
    return { ok: false, error: "Choose what the rule does when it matches." };
  }

  if (!ACTIONS_FOR_TYPE[type].includes(action)) {
    return {
      ok: false,
      error: `A ${type.replace(/_/g, " ").toLowerCase()} rule cannot ${action
        .replace(/_/g, " ")
        .toLowerCase()}.`,
    };
  }

  // Each type's own numbers are validated separately, so the error names the
  // field that is actually wrong.
  const data: Record<string, unknown> = {};

  if (type === ModerationRuleType.WORD_FILTER) {
    const blockedWords = parseWordList(String(formData.get("blockedWords") ?? ""));

    if (blockedWords.length === 0) {
      return { ok: false, error: "Add at least one blocked word or phrase." };
    }

    data.blockedWords = blockedWords;
    data.warnOnMatch = formData.get("warnOnMatch") === "on";
  }

  if (type === ModerationRuleType.SPAM) {
    const messageLimit = positiveInt(formData.get("messageLimit"));
    const windowSeconds = positiveInt(formData.get("windowSeconds"));

    if (messageLimit === null) {
      return { ok: false, error: "Set how many messages are allowed." };
    }

    if (windowSeconds === null) {
      return { ok: false, error: "Set the window those messages are counted in." };
    }

    // A window of a few seconds would time out normal conversation, so the
    // floor is a minute. A ceiling keeps the map small.
    if (windowSeconds < 60) {
      return { ok: false, error: "The window must be at least 60 seconds." };
    }

    if (windowSeconds > 600) {
      return { ok: false, error: "The window can be at most 600 seconds." };
    }

    data.messageLimit = messageLimit;
    data.windowSeconds = windowSeconds;
  }

  if (type === ModerationRuleType.RAID_PROTECTION) {
    const joinThreshold = positiveInt(formData.get("joinThreshold"));
    const joinWindowSeconds = positiveInt(formData.get("joinWindowSeconds"));

    if (joinThreshold === null) {
      return { ok: false, error: "Set how many joins trigger protection." };
    }

    if (joinWindowSeconds === null) {
      return { ok: false, error: "Set the window those joins are counted in." };
    }

    if (joinWindowSeconds < 5) {
      return { ok: false, error: "The join window must be at least 5 seconds." };
    }

    if (joinWindowSeconds > 900) {
      return { ok: false, error: "The join window can be at most 900 seconds." };
    }

    data.joinThreshold = joinThreshold;
    data.joinWindowSeconds = joinWindowSeconds;
  }

  if (action === ModerationActionType.TIMEOUT) {
    const duration = positiveInt(durationRaw);

    if (duration === null) {
      return { ok: false, error: "Set how long the timeout lasts, in minutes." };
    }

    // Discord's own maximum.
    if (duration > 60 * 24 * 28) {
      return { ok: false, error: "A timeout can be at most 28 days." };
    }

    data.actionDurationMins = duration;
  }

  // The channel id comes from the browser, so it is checked against the real
  // channel list before being stored.
  if (logChannelId) {
    const channels = await listGuildChannels(guild.discordId);

    if (!channels.some((channel) => channel.id === logChannelId)) {
      return { ok: false, error: "That log channel was not found in your server." };
    }

    data.logChannelId = logChannelId;
  }

  await prisma.moderationRule.create({
    data: {
      guildId: guild.id,
      name,
      type,
      action,
      ...data,
    },
  });

  log.info("Created moderation rule", { guildId: guild.id, name, type, action });

  return { ok: true };
}

export async function toggleModerationRuleAction(ruleId: string): Promise<void> {
  const guild = await requireGuild();

  const rule = await prisma.moderationRule.findFirst({
    where: { id: ruleId, guildId: guild.id },
    select: { id: true, enabled: true },
  });

  if (!rule) return;

  await prisma.moderationRule.update({
    where: { id: rule.id },
    data: { enabled: !rule.enabled },
  });
}

export async function deleteModerationRuleAction(ruleId: string): Promise<void> {
  const guild = await requireGuild();

  // The log records keep a null ruleId rather than cascading away, so the
  // moderation history survives the rule that caused it.
  const deleted = await prisma.moderationRule.deleteMany({
    where: { id: ruleId, guildId: guild.id },
  });

  if (deleted.count > 0) {
    log.info("Deleted moderation rule", { guildId: guild.id, ruleId });
  }
}