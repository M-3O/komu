import { GatewayIntentBits, Partials } from "discord.js";

/**
 * Bot process configuration.
 *
 * The bot runs as its own Node process (`npm run bot`) alongside the Next.js
 * app. Both read the same `.env.local`, which the entry point loads.
 *
 * Everything here is a pure read of `process.env`, so nothing executes at
 * import time and a missing token surfaces as a clear message rather than an
 * undefined value deep in the client.
 */

/** Discord API version the client talks to. */
export const DISCORD_API_VERSION = "10";

/**
 * Gateway intents.
 *
 * `GuildMembers`, `GuildMessages` and `MessageContent` are privileged: they
 * must be enabled in the Discord developer portal under
 * Bot > Privileged Gateway Intents, otherwise events for them silently never
 * arrive.
 */
export const INTENTS = [
  // Guild create/update/delete, and the guild list on connect.
  GatewayIntentBits.Guilds,
  // Join and leave events, needed for anti-raid and member sync.
  GatewayIntentBits.GuildMembers,
  // Message create/delete, needed for XP and moderation.
  GatewayIntentBits.GuildMessages,
  // Reads message text. Privileged.
  GatewayIntentBits.MessageContent,
  // Emoji reactions, used for stream attendance later.
  GatewayIntentBits.GuildMessageReactions,
] as const;

/**
 * Partials let the bot receive events for objects not in cache, such as a
 * reaction on a message it has not seen.
 */
export const PARTIALS = [
  Partials.Channel,
  Partials.Message,
  Partials.Reaction,
] as const;

function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `${name} is not set. Add it to .env.local before starting the bot.`,
    );
  }

  return value;
}

/** The bot token. Read only here, never passed around. */
export function getBotToken(): string {
  return required("DISCORD_BOT_TOKEN");
}

/** This application's id, used when registering slash commands. */
export function getApplicationId(): string {
  return required("DISCORD_CLIENT_ID");
}

/** True when the essential bot credentials are present. */
export function isBotConfigured(): boolean {
  return Boolean(process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_CLIENT_ID);
}