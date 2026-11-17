import "server-only";

import { classifyError } from "@/lib/monitoring/errors";
import { observeOperation } from "@/lib/monitoring/health";

import { createLogger } from "@/lib/logger";
import {
  fetchWithTimeout,
  isTimeoutError,
} from "@/lib/http/fetch-with-timeout";

/**
 * Discord REST calls that do not need a gateway connection.
 *
 * The bot process holds the gateway and handles events. Alert delivery does
 * not: posting a message is a plain HTTPS request authenticated with the bot
 * token. Keeping it here means stream detection can run in the web app
 * without the bot being online.
 *
 * https://discord.com/developers/docs/reference
 */

const DISCORD_API_BASE = "https://discord.com/api/v10";

/**
 * Discord channel types that can receive a normal text message.
 *
 * Text, announcement, public/private thread, and announcement thread. Voice
 * and category channels are deliberately excluded: Discord accepts some
 * messages there, but they are not a sensible announcement destination.
 */
const TEXT_CHANNEL_TYPES = new Set([0, 5, 10, 11, 12]);

/** Whether a Discord channel type is a text destination. */
export function isTextChannelType(type: number): boolean {
  return TEXT_CHANNEL_TYPES.has(type);
}

const log = createLogger("discord");

/** Result of a Discord write. Never throws, for the same reason as the bot. */
export interface DiscordWriteResult {
  ok: boolean;
  /** Present when ok is false. Safe to show to a creator. */
  error?: string;
  /** Discord error code, for logs. */
  code?: string;
  status?: number;
  retryAfterMs?: number;
}

const OK: DiscordWriteResult = { ok: true };

function getBotToken(): string {
  const token = process.env.DISCORD_BOT_TOKEN;

  if (!token) {
    throw new Error(
      "DISCORD_BOT_TOKEN is not set. Add it to .env.local before sending Discord messages.",
    );
  }

  return token;
}

interface DiscordErrorBody {
  message?: string;
  code?: number;
  retry_after?: number;
}

async function discordRequest<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<{ ok: true; data: T } | { ok: false; result: DiscordWriteResult }> {
  return observeOperation(method === "GET" ? "discord.read" : "discord.write", "discord",
    () => performDiscordRequest<T>(method, path, body),
    result => result.ok ? "success" : classifyError({ code: result.result.code, status: result.status }, "discord"));
}

async function performDiscordRequest<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown,
): Promise<{ ok: true; data: T } | { ok: false; result: DiscordWriteResult; status?: number }> {
  let response: Response;

  try {
    response = await fetchWithTimeout(`${DISCORD_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${getBotToken()}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      log.error("Discord request timed out", { method, path });

      return {
        ok: false,
        result: {
          ok: false,
          error: "Discord did not respond in time. Try again.",
          code: "TIMEOUT",
        },
      };
    }

    // Network failure: Discord unreachable or DNS.
    log.error("Discord request failed", {
      method,
      path,
      reason: classifyError(error, "discord"),
    });
    return {
      ok: false,
      result: { ok: false, error: "Could not reach Discord.", code: "NETWORK" },
    };
  }

  if (response.ok) {
    return { ok: true, data: (await response.json()) as T };
  }

  const payload = (await response.json().catch(() => ({}))) as DiscordErrorBody;
  const retryAfter = Math.max(Number(response.headers.get("Retry-After") ?? 0), payload.retry_after ?? 0);

  // 50013 missing permissions, 50001/403 role or channel hierarchy.
  let message = "Discord rejected the request.";

  if (response.status === 401) {
    message = "The bot token is invalid.";
  } else if (response.status === 403 || payload.code === 50013) {
    message = "The bot is missing permission to do that in this channel.";
  } else if (response.status === 404) {
    message =
      "That channel no longer exists. Pick another one in Stream Alerts.";
  } else if (response.status === 429) {
    message = "Discord is rate limiting the bot. Try again shortly.";
  }

  log.warn("Discord request rejected", {
    method,
    path,
    status: response.status,
    code: payload.code,
  });

  return {
    ok: false,
    status: response.status,
    result: {
      ok: false,
      error: message,
      code: payload.code ? `DISCORD_${payload.code}` : `HTTP_${response.status}`,
      status: response.status,
      retryAfterMs: response.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.ceil(retryAfter * 1000) : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The parts of a Discord channel the alert UI needs. */
export interface DiscordChannelInfo {
  id: string;
  name: string;
  type: number;
  /** Position, for ordering. */
  position: number;
}

/** The parts of a Discord role the alert UI needs. */
export interface DiscordRoleInfo {
  id: string;
  name: string;
  color: number;
  position: number;
}

interface RawChannel {
  id: string;
  name: string | null;
  type: number;
  position: number;
}

interface RawRole {
  id: string;
  name: string;
  color: number;
  position: number;
}

/** Text channels in a guild, ordered by position. */
export async function listGuildChannels(
  guildId: string,
): Promise<DiscordChannelInfo[]> {
  const result = await discordRequest<RawChannel[]>("GET", `/guilds/${guildId}/channels`);

  if (!result.ok) {
    log.warn("Could not list channels", { guildId, code: result.result.code });
    return [];
  }

  return result.data
    .filter((channel) => typeof channel.name === "string")
    .map((channel) => ({
      id: channel.id,
      name: channel.name as string,
      type: channel.type,
      position: channel.position,
    }))
    .sort((a, b) => a.position - b.position);
}

/** Roles in a guild, ordered by position. */
export async function listGuildRoles(
  guildId: string,
): Promise<DiscordRoleInfo[]> {
  const result = await discordRequest<RawRole[]>("GET", `/guilds/${guildId}/roles`);

  if (!result.ok) {
    log.warn("Could not list roles", { guildId, code: result.result.code });
    return [];
  }

  return result.data
    .map((role) => ({
      id: role.id,
      name: role.name,
      color: role.color,
      position: role.position,
    }))
    .sort((a, b) => a.position - b.position);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** A Discord embed. Only the fields Komu uses. */
export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  image?: { url: string };
  thumbnail?: { url: string };
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
}

/** A clickable button, used for the Watch Now link. */
export type DiscordButton =
  | { type: 2; style: 5; label: string; url: string }
  | { type: 2; style: 1 | 2 | 3 | 4; label: string; custom_id: string };

/** One row of message components. */
export interface DiscordActionRow {
  type: 1;
  components: DiscordButton[];
}

export interface SendMessageInput {
  nonce?: string;
  /** Plain text above the embed. Used for the role mention. */
  content?: string;
  embeds?: DiscordEmbed[];
  components?: DiscordActionRow[];
  /**
   * Which mentions Discord may turn into notifications.
   *
   * Omitted means "everything the content names", so a caller that includes
   * creator-supplied text must set this explicitly.
   */
  allowedMentions?: {
    parse?: Array<"roles" | "users" | "everyone">;
    roles?: string[];
    users?: string[];
  };
}

/**
 * Post a message to a channel.
 *
 * Used both for live alerts and for the dashboard's test-alert button, so a
 * creator can verify the channel and role before waiting for a real stream.
 */
export async function sendChannelMessage(
  channelId: string,
  input: SendMessageInput,
): Promise<DiscordWriteResult & { messageId?: string }> {
  const result = await discordRequest<{ id: string }>(
    "POST",
    `/channels/${channelId}/messages`,
    {
      content: input.content,
      embeds: input.embeds,
      components: input.components,
      // Discord's wire format is snake_case; the TypeScript API stays
      // camelCase. Dropping this field would silently allow every mention in
      // the content, so it is mapped explicitly rather than passed through.
      allowed_mentions: input.allowedMentions,
      nonce: input.nonce,
      enforce_nonce: input.nonce ? true : undefined,
    },
  );

  if (!result.ok) return result.result;

  // The id is returned so callers can identify the message later, which is
  // how reactions on a live alert are matched back to a stream session.
  return { ...OK, messageId: result.data.id };
}

export async function findOwnAlertMessage(channelId: string, reference: string, attemptedAt: Date) {
  const bot = await discordRequest<{ id: string }>("GET", "/users/@me");
  if (!bot.ok || !bot.data.id) return null;
  // Start at the send window so later channel traffic cannot exhaust the scan.
  const discordEpoch = 1420070400000;
  let before = (BigInt(+attemptedAt + 120_000 - discordEpoch) << BigInt(22)).toString();
  for (let page = 0; page < 5; page += 1) {
    const messages = await discordRequest<Array<{
      id: string;
      author: { id: string };
      content: string;
      timestamp: string;
    }>>("GET", `/channels/${channelId}/messages?limit=100&before=${before}`);
    if (!messages.ok || !Array.isArray(messages.data)) return null;
    for (const message of messages.data) {
      const postedAt = new Date(message.timestamp);
      if (+postedAt < +attemptedAt - 60_000) return null;
      if (message.author.id === bot.data.id && message.content.endsWith(`-# Alert ref: ${reference}`)) {
        return { id: message.id, postedAt };
      }
    }
    if (messages.data.length < 100) break;
    before = messages.data[99].id;
  }
  return null;
}

export async function addChannelMessageButton(channelId: string, messageId: string, button: DiscordButton) {
  const path = `/channels/${channelId}/messages/${messageId}`;
  const current = await discordRequest<{ components?: DiscordActionRow[] }>("GET", path);
  if (!current.ok) return current.result;
  const rows = current.data.components ?? [];
  if ("custom_id" in button && rows.some((row) => row.components.some((component) =>
    "custom_id" in component && component.custom_id === button.custom_id))) return OK;
  if (rows.length >= 5) return { ok: false, error: "This post has no space for another button." };
  const edited = await discordRequest<unknown>("PATCH", path, {
    components: [...rows, { type: 1, components: [button] }],
    allowed_mentions: { parse: [] },
  });
  return edited.ok ? OK : edited.result;
}

export async function readChannelMessage(channelId: string, messageId: string) {
  const result = await discordRequest<{ id: string }>("GET", `/channels/${channelId}/messages/${messageId}`);
  return result.ok ? OK : result.result;
}

export async function inspectGuildRole(guildId: string, roleId: string) {
  const roles = await discordRequest<Array<{
    id: string; name: string; position: number; permissions: string; managed: boolean;
  }>>("GET", `/guilds/${guildId}/roles`);
  if (!roles.ok) return "Could not load the server’s roles.";
  const target = roles.data.find((role) => role.id === roleId);
  if (!target || roleId === guildId || target.managed) return "Choose a role that Komu can assign.";

  const bot = await discordRequest<{ id: string }>("GET", "/users/@me");
  if (!bot.ok) return "Could not verify Komu’s Discord permissions.";
  const member = await discordRequest<{ roles: string[] }>("GET", `/guilds/${guildId}/members/${bot.data.id}`);
  if (!member.ok) return "Could not verify Komu’s role in this server.";
  const held = roles.data.filter((role) => role.id === guildId || member.data.roles.includes(role.id));
  const permissions = held.reduce((bits, role) => bits | BigInt(role.permissions), BigInt(0));
  if ((permissions & BigInt(8 | (1 << 28))) === BigInt(0)) return "Give Komu permission to manage roles.";
  const above = held.some((role) => role.id !== guildId && (role.position > target.position ||
    (role.position === target.position && BigInt(role.id) < BigInt(target.id))));
  return above ? null : "Move Komu’s role above the season reward role.";
}

export async function guildHasRole(guildId: string, roleId: string) {
  const roles = await discordRequest<Array<{ id: string }>>("GET", `/guilds/${guildId}/roles`);
  return roles.ok ? roles.data.some((role) => role.id === roleId) : null;
}
