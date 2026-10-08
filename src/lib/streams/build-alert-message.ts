import "server-only";

import type { DiscordActionRow, DiscordEmbed } from "@/lib/discord/rest";
import type { AlertMessageMode } from "@prisma/client";
import type { StreamInfo } from "@/lib/streams/types";

/**
 * Turning stream data and alert settings into a Discord message.
 *
 * Pure functions, so the wording, button and mention can be checked without
 * posting anything (PRD section 7.4).
 */

/** Discord's brand purple, matching the dashboard accent. */
export const ALERT_COLOR = 0x7c5cff;

/** The alert settings a message is built from. */
export interface AlertSettings {
  channelId: string | null;
  mentionRoleId: string | null;
  mentionEnabled: boolean;
  messageMode: AlertMessageMode;
  customMessage: string | null;
  embedEnabled: boolean;
  embedColor: string;
  showThumbnail: boolean;
  showViewerCount: boolean;
  showGame: boolean;
  watchButtonEnabled: boolean;
  watchButtonLabel: string;
}

export interface AlertMessageInput {
  stream: StreamInfo;
  settings: AlertSettings;
  creatorName: string;
  /** Marks the message as a test so creators can tell it apart. */
  isTest?: boolean;
}

export interface BuiltAlertMessage {
  content?: string;
  embeds?: DiscordEmbed[];
  components?: DiscordActionRow[];
  /** Set when the message cannot be sent, e.g. no channel chosen. */
  error?: string;
}

/** Discord wraps user text in `{placeholders}`. */
const PLACEHOLDER_PATTERN = /\{(title|game|url|creator|viewers)\}/g;

/** Replace `{title}`, `{game}`, `{creator}`, `{viewers}`, `{url}` in a string. */
export function applyPlaceholders(
  template: string,
  stream: StreamInfo,
  creatorName: string,
): string {
  const values: Record<string, string> = {
    title: stream.title ?? "a stream",
    game: stream.game ?? "just chatting",
    url: stream.url,
    creator: creatorName,
    viewers:
      stream.viewerCount === null ? "0" : String(stream.viewerCount),
  };

  return template.replace(PLACEHOLDER_PATTERN, (match, key: string) =>
    key in values ? values[key] : match,
  );
}

/** The mention line above the embed. Empty when no role is configured. */
export function buildMentionContent(settings: AlertSettings): string {
  if (!settings.mentionEnabled || !settings.mentionRoleId) return "";
  return `<@&${settings.mentionRoleId}>`;
}

/** The embed body, honouring the creator's visibility toggles. */
export function buildEmbed(input: AlertMessageInput): DiscordEmbed {
  const { stream, settings, creatorName, isTest } = input;

  const description =
    settings.messageMode === "CUSTOM" && settings.customMessage
      ? applyPlaceholders(settings.customMessage, stream, creatorName)
      : stream.title ?? `${creatorName} is live.`;

  const fields: DiscordEmbed["fields"] = [];

  if (settings.showGame && stream.game) {
    fields.push({ name: "Playing", value: stream.game, inline: true });
  }

  if (settings.showViewerCount && stream.viewerCount !== null) {
    fields.push({
      name: "Viewers",
      value: String(stream.viewerCount),
      inline: true,
    });
  }

  const embed: DiscordEmbed = {
    title: `${creatorName} is live`,
    url: stream.url,
    description,
    color: parseColor(settings.embedColor),
    fields: fields.length > 0 ? fields : undefined,
  };

  // Discord will not render a thumbnail URL it cannot fetch, so only set it
  // when the provider actually gave us one.
  if (settings.showThumbnail && stream.thumbnail) {
    embed.image = { url: stream.thumbnail };
  }

  embed.footer = {
    text: isTest
      ? "Komu test alert"
      : `${stream.provider} · ${stream.game ?? "Stream"}`,
  };

  return embed;
}

/** The Watch Now button. */
export function buildWatchButton(settings: AlertSettings): DiscordActionRow {
  // A blank or whitespace label would render as an empty button, so fall
  // back rather than trusting the stored value.
  const label = settings.watchButtonLabel.trim();

  return {
    type: 1,
    components: [
      {
        type: 2,
        style: 5,
        label: label.length > 0 ? label : "Watch Now",
        // Filled in by the caller from the stream URL.
        url: "https://www.twitch.tv",
      },
    ],
  };
}

/** Assemble the full message. */
export function buildAlertMessage(
  input: AlertMessageInput,
): BuiltAlertMessage {
  const { stream, settings } = input;

  if (!settings.channelId) {
    return { error: "Choose a Discord channel first." };
  }

  const message: BuiltAlertMessage = {};

  const content = buildMentionContent(settings);
  if (content) message.content = content;

  if (settings.embedEnabled) {
    message.embeds = [buildEmbed(input)];
  } else if (settings.messageMode === "CUSTOM" && settings.customMessage) {
    // Without an embed the custom text has to go somewhere visible.
    message.content = [content, applyPlaceholders(settings.customMessage, stream, input.creatorName)]
      .filter(Boolean)
      .join("\n");
  }

  if (settings.watchButtonEnabled) {
    const row = buildWatchButton(settings);
    row.components[0].url = stream.url;
    message.components = [row];
  }

  return message;
}

/** Parse `#7c5cff` or `7c5cff` into Discord's integer colour. */
export function parseColor(value: string): number {
  const hex = value.trim().replace(/^#/, "");

  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return Number.parseInt(hex, 16);
  }

  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    // Expand #abc to #aabbcc.
    const [r, g, b] = hex.split("");
    return Number.parseInt(`${r}${r}${g}${g}${b}${b}`, 16);
  }

  return ALERT_COLOR;
}