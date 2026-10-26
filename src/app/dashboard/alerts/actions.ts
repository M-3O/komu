"use server";

import { AlertMessageMode, StreamingProvider } from "@prisma/client";
import { refresh } from "next/cache";

import { requireGuild } from "@/lib/dashboard/require-guild";
import { prisma } from "@/lib/db";
import {
  buildAlertMessage,
  type AlertSettings,
} from "@/lib/streams/build-alert-message";
import { sendChannelMessage } from "@/lib/discord/rest";
import { buildChannelUrl as buildKickChannelUrl } from "@/lib/kick/normalize";
import { createLogger } from "@/lib/logger";
import { buildChannelUrl as buildTwitchChannelUrl } from "@/lib/twitch/normalize";
import { INPUT_LIMITS } from "@/lib/validation/limits";
import { buildChannelUrl as buildYouTubeChannelUrl } from "@/lib/youtube/normalize";

/**
 * Stream alert configuration actions.
 *
 * Every value here arrives from the browser. Channel and role ids are
 * checked against the guild's real channel and role list before being saved,
 * so a tampered form cannot point alerts at another server's channel
 * (PRD section 11).
 */

const log = createLogger("stream");

/**
 * The sample's link has to match the account's provider.
 *
 * These builders are the same ones the adapters use, so a test alert cannot
 * quietly point a YouTube or Kick creator at twitch.tv.
 */
const CHANNEL_URL_BUILDERS: Record<
  StreamingProvider,
  (username: string) => string
> = {
  [StreamingProvider.TWITCH]: buildTwitchChannelUrl,
  [StreamingProvider.YOUTUBE]: buildYouTubeChannelUrl,
  [StreamingProvider.KICK]: buildKickChannelUrl,
};

export interface AlertFormState {
  ok?: boolean;
  error?: string;
}

// The initial state lives with the form that uses it, in AlertForm. A
// "use server" file may only export async functions. Exporting a plain object
// fails at runtime, in the browser, when the Client Component imports the
// module: the server render still succeeds and returns 200, so only the error
// boundary shows the problem.

/** Parse the colour field, rejecting anything that is not a hex colour. */
function readColor(value: string): string | null {
  const hex = value.trim().replace(/^#/, "");

  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return `#${hex}`;
}

function readBoolean(value: FormDataEntryValue | null): boolean {
  return value === "on" || value === "true" || value === "1";
}

export async function saveAlertSettingsAction(
  _previous: AlertFormState | null,
  formData: FormData,
): Promise<AlertFormState> {
  const guild = await requireGuild("/dashboard/alerts");
  const streamingAccountId = String(formData.get("streamingAccountId") ?? "");

  const account = await prisma.streamingAccount.findFirst({
    where: { id: streamingAccountId, guildId: guild.id },
    select: { id: true },
  });

  if (!account) {
    return { ok: false, error: "That channel is not connected." };
  }

  const channelId = String(formData.get("channelId") ?? "");
  const mentionRoleId = String(formData.get("mentionRoleId") ?? "");
  const embedColor = readColor(String(formData.get("embedColor") ?? ""));

  if (!embedColor) {
    return { ok: false, error: "Embed colour must be a hex value like #7c5cff." };
  }

  // Verify the channel really exists in this guild before storing it.
  if (channelId) {
    const { listGuildChannels } = await import("@/lib/discord/rest");
    const channels = await listGuildChannels(guild.discordId);

    if (!channels.some((channel) => channel.id === channelId)) {
      return {
        ok: false,
        error: "That Discord channel was not found in your server.",
      };
    }
  }

  if (mentionRoleId) {
    const { listGuildRoles } = await import("@/lib/discord/rest");
    const roles = await listGuildRoles(guild.discordId);

    if (!roles.some((role) => role.id === mentionRoleId)) {
      return { ok: false, error: "That role was not found in your server." };
    }
  }

  const customMessage = String(formData.get("customMessage") ?? "").trim();
  const watchButtonLabel = String(
    formData.get("watchButtonLabel") ?? "",
  ).trim();

  if (customMessage.length > INPUT_LIMITS.customMessage) {
    return {
      ok: false,
      error: `Custom message must be ${INPUT_LIMITS.customMessage.toLocaleString()} characters or fewer.`,
    };
  }

  // Discord rejects the whole message when the label is too long, which would
  // leave the creator with a rule that silently never posts.
  if (watchButtonLabel.length > INPUT_LIMITS.buttonLabel) {
    return {
      ok: false,
      error: `Button label must be ${INPUT_LIMITS.buttonLabel} characters or fewer (Discord's limit).`,
    };
  }

  const settings = {
    enabled: readBoolean(formData.get("enabled")),
    channelId: channelId || null,
    mentionRoleId: mentionRoleId || null,
    mentionEnabled: readBoolean(formData.get("mentionEnabled")),
    messageMode:
      String(formData.get("messageMode") ?? "DEFAULT") === "CUSTOM"
        ? AlertMessageMode.CUSTOM
        : AlertMessageMode.DEFAULT,
    customMessage: customMessage || null,
    embedEnabled: readBoolean(formData.get("embedEnabled")),
    embedColor,
    showThumbnail: readBoolean(formData.get("showThumbnail")),
    showViewerCount: readBoolean(formData.get("showViewerCount")),
    showGame: readBoolean(formData.get("showGame")),
    watchButtonEnabled: readBoolean(formData.get("watchButtonEnabled")),
    watchButtonLabel: watchButtonLabel || "Watch Now",
  };

  await prisma.alertConfiguration.upsert({
    where: { streamingAccountId: account.id },
    update: settings,
    create: { streamingAccountId: account.id, guildId: guild.id, ...settings },
  });

  log.info("Saved alert settings", {
    guildId: guild.id,
    streamingAccountId: account.id,
    enabled: settings.enabled,
  });

  refresh();

  return { ok: true };
}

/**
 * Post a sample alert so a creator can confirm the channel and role before
 * waiting for a real stream (IMPLEMENTATION_PLAN section 8).
 */
export async function sendTestAlertAction(
  streamingAccountId: string,
): Promise<AlertFormState> {
  const guild = await requireGuild("/dashboard/alerts");

  const account = await prisma.streamingAccount.findFirst({
    where: { id: streamingAccountId, guildId: guild.id },
    select: { id: true, provider: true, username: true, displayName: true, alertConfig: true },
  });

  if (!account) {
    return { ok: false, error: "That channel is not connected." };
  }

  if (!account.alertConfig?.channelId) {
    return { ok: false, error: "Choose a Discord channel first." };
  }

  const settings = account.alertConfig as unknown as AlertSettings;

  // A representative sample so every toggle is visible in the test message.
  const sample = {
    provider: account.provider,
    creatorId: "sample",
    creatorUsername: account.username,
    creatorDisplayName: account.displayName,
    providerStreamId: "test",
    title: "Sample stream title",
    game: "Sample category",
    thumbnail: null,
    viewerCount: 1234,
    url: CHANNEL_URL_BUILDERS[account.provider](account.username),
    startedAt: new Date(),
  };

  const message = buildAlertMessage({
    stream: sample,
    settings,
    creatorName: account.displayName ?? account.username,
    isTest: true,
  });

  if (message.error || !settings.channelId) {
    return { ok: false, error: message.error ?? "Choose a Discord channel first." };
  }

  const result = await sendChannelMessage(settings.channelId, {
    content: message.content,
    embeds: message.embeds,
    components: message.components,
    allowedMentions: message.allowedMentions,
  });

  if (!result.ok) {
    log.warn("Test alert failed", {
      guildId: guild.id,
      streamingAccountId: account.id,
      code: result.code,
    });
    return { ok: false, error: result.error ?? "Could not send the test alert." };
  }

  return { ok: true };
}
