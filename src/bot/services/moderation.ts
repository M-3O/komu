import {
  DiscordAPIError,
  GuildMember,
  PermissionFlagsBits,
  type Message,
  type SendableChannels,
} from "discord.js";

import { createLogger } from "@/lib/logger";
import { clampTimeoutMs } from "./timeout";

/**
 * Discord operations that change a member's state.
 *
 * Every helper returns a result object instead of throwing, so callers
 * (commands, and later the reward and moderation services) can react to a
 * failure instead of crashing a handler. Discord denies these actions for
 * ordinary reasons all the time: the role is above the bot's highest role,
 * the bot lacks permission, the member left, or the action was already done.
 */

const log = createLogger("bot");

export interface DiscordActionResult {
  ok: boolean;
  /** Present when `ok` is false. Safe to show in a channel. */
  error?: string;
  /** Present when `ok` is false, for logging only. */
  code?: string;
}

const OK: DiscordActionResult = { ok: true };

/**
 * Turn a Discord error into something worth showing a member.
 *
 * Discord's messages are developer-facing, so they are logged rather than
 * displayed; the user sees a short explanation instead.
 */
function describeError(error: unknown): DiscordActionResult {
  if (!(error instanceof DiscordAPIError)) {
    return {
      ok: false,
      error: "Something went wrong. Try again in a moment.",
      code: error instanceof Error ? error.message : "unknown",
    };
  }

  // 50013: missing permissions.
  if (error.code === 50013) {
    return {
      ok: false,
      error: "The bot is missing permission to do that.",
      code: "MISSING_PERMISSIONS",
    };
  }

  // 50013/50001 with a role hierarchy problem is reported as 50013 with this
  // message; Discord gives no distinct code for hierarchy failures.
  if (/role/i.test(error.message) && /higher|above/i.test(error.message)) {
    return {
      ok: false,
      error: "That role is above the bot's highest role, so it cannot be assigned.",
      code: "ROLE_HIERARCHY",
    };
  }

  // 10007: unknown member (left the server).
  if (error.code === 10007) {
    return {
      ok: false,
      error: "That member is no longer in the server.",
      code: "MEMBER_GONE",
    };
  }

  // 160002: anonymous webhook-style rate limit on the interaction.
  if (error.code === 160002) {
    return { ok: false, error: "Too fast. Try again shortly.", code: "RATE_LIMITED" };
  }

  return {
    ok: false,
    error: "That action could not be completed.",
    code: `DISCORD_${error.code}`,
  };
}

function logFailure(
  action: string,
  guildId: string,
  targetDiscordId: string,
  result: DiscordActionResult,
) {
  log.warn(`${action} failed`, {
    guildId,
    targetDiscordId,
    code: result.code,
  });
}

/** Assign a role, tolerating an already-present role. */
export async function addRoleToMember(
  member: GuildMember,
  roleId: string,
): Promise<DiscordActionResult> {
  if (member.roles.cache.has(roleId)) return OK;

  try {
    await member.roles.add(roleId);
    return OK;
  } catch (error) {
    const result = describeError(error);
    logFailure("addRole", member.guild.id, member.id, result);
    return result;
  }
}

/** Remove a role, tolerating a member who does not have it. */
export async function removeRoleFromMember(
  member: GuildMember,
  roleId: string,
): Promise<DiscordActionResult> {
  if (!member.roles.cache.has(roleId)) return OK;

  try {
    await member.roles.remove(roleId);
    return OK;
  } catch (error) {
    const result = describeError(error);
    logFailure("removeRole", member.guild.id, member.id, result);
    return result;
  }
}

/**
 * Time a member out.
 *
 * `durationMs` is capped at 28 days, which is Discord's own maximum.
 */
export async function timeoutMember(
  member: GuildMember,
  durationMs: number,
  reason: string,
): Promise<DiscordActionResult> {
  const duration = clampTimeoutMs(durationMs);

  // A member the bot cannot moderate is a configuration problem worth
  // catching before the API call.
  if (!member.moderatable) {
    const result = {
      ok: false,
      error: "The bot cannot moderate that member.",
      code: "NOT_MODERATABLE",
    };
    logFailure("timeout", member.guild.id, member.id, result);
    return result;
  }

  try {
    await member.timeout(duration, reason);
    return OK;
  } catch (error) {
    const result = describeError(error);
    logFailure("timeout", member.guild.id, member.id, result);
    return result;
  }
}

/** Clear an active timeout. */
export async function removeTimeout(
  member: GuildMember,
  reason: string,
): Promise<DiscordActionResult> {
  try {
    await member.timeout(null, reason);
    return OK;
  } catch (error) {
    const result = describeError(error);
    logFailure("removeTimeout", member.guild.id, member.id, result);
    return result;
  }
}

export async function kickMember(
  member: GuildMember,
  reason: string,
): Promise<DiscordActionResult> {
  if (!member.kickable) {
    const result = {
      ok: false,
      error: "The bot cannot remove that member.",
      code: "NOT_KICKABLE",
    };
    logFailure("kick", member.guild.id, member.id, result);
    return result;
  }

  try {
    await member.kick(reason);
    return OK;
  } catch (error) {
    const result = describeError(error);
    logFailure("kick", member.guild.id, member.id, result);
    return result;
  }
}

export async function banMember(
  member: GuildMember,
  reason: string,
  deleteMessageDays = 0,
): Promise<DiscordActionResult> {
  if (!member.bannable) {
    const result = {
      ok: false,
      error: "The bot cannot ban that member.",
      code: "NOT_BANNABLE",
    };
    logFailure("ban", member.guild.id, member.id, result);
    return result;
  }

  try {
    await member.ban({ reason, deleteMessageSeconds: deleteMessageDays * 86400 });
    return OK;
  } catch (error) {
    const result = describeError(error);
    logFailure("ban", member.guild.id, member.id, result);
    return result;
  }
}

/**
 * Whether the bot may moderate a member.
 *
 * The bot can never act on the server owner or on itself, and needs
 * `Moderate Members` (timeouts) or `Ban Members` to act at all.
 */
export function botCanModerate(
  botMember: GuildMember,
  target: GuildMember,
  action: "timeout" | "kick" | "ban",
): boolean {
  if (target.id === botMember.id) return false;
  if (target.id === target.guild.ownerId) return false;

  const required =
    action === "ban"
      ? PermissionFlagsBits.BanMembers
      : action === "kick"
        ? PermissionFlagsBits.KickMembers
        : PermissionFlagsBits.ModerateMembers;

  if (!botMember.permissions.has(required)) return false;

  // The bot's highest role must sit above the target's highest role.
  const botRole = botMember.roles.highest;
  const targetRole = target.roles.highest;

  return botRole.id !== botMember.guild.id && botRole.position > targetRole.position;
}

/** Delete a message, tolerating one the bot can no longer see. */
export async function deleteMessage(message: Message): Promise<DiscordActionResult> {
  try {
    await message.delete();
    return OK;
  } catch (error) {
    const result = describeError(error);
    // Discord refuses to delete a message older than two weeks, and a missing
    // Manage Messages shows up here too. Neither is worth retrying.
    logFailure("deleteMessage", message.guildId ?? "", message.author.id, result);
    return result;
  }
}

/** Send a plain message to a channel, reporting failure rather than throwing. */
export async function sendChannelMessage(
  channel: SendableChannels,
  content: string,
): Promise<DiscordActionResult> {
  try {
    await channel.send(content);
    return OK;
  } catch (error) {
    const result = describeError(error);
    log.warn("sendChannelMessage failed", {
      channelId: channel.id,
      code: result.code,
    });
    return result;
  }
}