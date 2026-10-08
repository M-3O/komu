"use server";

import { AlertMessageMode } from "@prisma/client";

import { requireCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import {
  buildAlertMessage,
  type AlertSettings,
} from "@/lib/streams/build-alert-message";
import { sendChannelMessage } from "@/lib/discord/rest";
import { createLogger } from "@/lib/logger";

/**
 * Stream alert configuration actions.
 *
 * Every value here arrives from the browser. Channel and role ids are
 * checked against the guild's real channel and role list before being saved,
 * so a tampered form cannot point alerts at another server's channel
 * (PRD section 11).
 */

const log = createLogger("stream");

export interface AlertFormState {
  ok?: boolean;
  error?: string;
}

/** Initial state for `useActionState`. */
export const INITIAL_STATE: AlertFormState = {};

async function requireGuild() {
  await requireCurrentUser("/dashboard/alerts");

  const guild = await prisma.guild.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, discordId: true },
  });

  if (!guild) {
    throw new Error("No Discord server is connected yet.");
  }

  return guild;
}

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
  const guild = await requireGuild();
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

  const settings = {
    enabled: readBoolean(formData.get("enabled")),
    channelId: channelId || null,
    mentionRoleId: mentionRoleId || null,
    mentionEnabled: readBoolean(formData.get("mentionEnabled")),
    messageMode:
      String(formData.get("messageMode") ?? "DEFAULT") === "CUSTOM"
        ? AlertMessageMode.CUSTOM
        : AlertMessageMode.DEFAULT,
    customMessage: String(formData.get("customMessage") ?? "").trim() || null,
    embedEnabled: readBoolean(formData.get("embedEnabled")),
    embedColor,
    showThumbnail: readBoolean(formData.get("showThumbnail")),
    showViewerCount: readBoolean(formData.get("showViewerCount")),
    showGame: readBoolean(formData.get("showGame")),
    watchButtonEnabled: readBoolean(formData.get("watchButtonEnabled")),
    watchButtonLabel:
      String(formData.get("watchButtonLabel") ?? "").trim() || "Watch Now",
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

  return { ok: true };
}

/**
 * Post a sample alert so a creator can confirm the channel and role before
 * waiting for a real stream (IMPLEMENTATION_PLAN section 8).
 */
export async function sendTestAlertAction(
  streamingAccountId: string,
): Promise<AlertFormState> {
  const guild = await requireGuild();

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
    url: "https://www.twitch.tv/",
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