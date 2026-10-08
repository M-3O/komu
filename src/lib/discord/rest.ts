import "server-only";

import { createLogger } from "@/lib/logger";

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

const log = createLogger("discord");

/** Result of a Discord write. Never throws, for the same reason as the bot. */
export interface DiscordWriteResult {
  ok: boolean;
  /** Present when ok is false. Safe to show to a creator. */
  error?: string;
  /** Discord error code, for logs. */
  code?: string;
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
}

async function discordRequest<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<{ ok: true; data: T } | { ok: false; result: DiscordWriteResult }> {
  let response: Response;

  try {
    response = await fetch(`${DISCORD_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${getBotToken()}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch (error) {
    // Network failure: Discord unreachable, DNS, timeout.
    log.error("Discord request failed", {
      method,
      path,
      reason: error instanceof Error ? error.message : "unknown",
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
    result: {
      ok: false,
      error: message,
      code: payload.code ? `DISCORD_${payload.code}` : `HTTP_${response.status}`,
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
export interface DiscordButton {
  type: 2;
  style: 1 | 2 | 3 | 4 | 5;
  label: string;
  url: string;
}

/** One row of message components. */
export interface DiscordActionRow {
  type: 1;
  components: DiscordButton[];
}

export interface SendMessageInput {
  /** Plain text above the embed. Used for the role mention. */
  content?: string;
  embeds?: DiscordEmbed[];
  components?: DiscordActionRow[];
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
): Promise<DiscordWriteResult> {
  const result = await discordRequest<{ id: string }>(
    "POST",
    `/channels/${channelId}/messages`,
    input,
  );

  if (!result.ok) return result.result;

  return OK;
}