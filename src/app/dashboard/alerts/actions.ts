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
import { lockStreamAccount, reconcileLiveAlert, recordStreamObservation, sendLiveAlert } from "@/lib/streams/alert-delivery";
import { noteLiveCheckFailure, observeLiveStream, readYouTubeVideoStatus } from "@/lib/streams/poller";
import { checkYouTubeBroadcast } from "@/lib/youtube/broadcast-tracking";
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
  message?: string;
}

export async function recoverLiveAlertAction(
  streamId: string, _previous: AlertFormState, form: FormData,
): Promise<AlertFormState> {
  const guild = await requireGuild("/dashboard/alerts");
  if (form.get("intent") === "check") {
    try {
      if (await reconcileLiveAlert(guild.id, streamId)) {
        refresh();
        return { ok: true, message: "Linked the existing Discord post. Members whose earlier reactions were missed can remove and re-add them." };
      }
      return { error: "Could not verify the original Discord post. Check channel access and message history." };
    } catch {
      return { error: "Could not check Discord right now. Try again shortly." };
    }
  }
  if (form.get("intent") !== "send") return { error: "Choose a recovery action." };
  const row = await prisma.stream.findFirst({
    where: { id: streamId, guildId: guild.id, endedAt: null, streamingAccount: { disconnectedAt: null } },
    include: { delivery: true, streamingAccount: { include: { alertConfig: true } } },
  });
  const account = row?.streamingAccount;
  const settings = account?.alertConfig;
  if (!row || !account || !row.delivery || !["SKIPPED", "BLOCKED", "PENDING"].includes(row.delivery.status) ||
    !settings?.enabled || !settings.channelId) {
    return { error: "This alert is no longer eligible. Refresh the page and check its settings." };
  }
  const channelId = String(form.get("channelId") ?? "");
  const roleId = String(form.get("roleId") ?? "") || null;
  if (settings.channelId !== channelId || (settings.mentionEnabled ? settings.mentionRoleId : null) !== roleId) {
    return { error: "The destination or mention changed. Refresh and confirm the new audience." };
  }
  const observedAt = new Date();
  let live;
  let confirmedEnd = true;
  try {
    if (account.provider === "YOUTUBE") {
      const result = await readYouTubeVideoStatus(account, row.providerStreamId);
      live = result.live;
      confirmedEnd = result.ended;
    } else {
      live = await observeLiveStream(account);
    }
  } catch {
    await noteLiveCheckFailure(account.id, observedAt);
    refresh();
    return { error: "The provider did not confirm the broadcast. Try again shortly." };
  }
  try {
    if (live?.providerStreamId !== row.providerStreamId) {
      const newerBroadcast = live?.startedAt && +live.startedAt > +row.startedAt;
      if (newerBroadcast || (!live && confirmedEnd)) {
        await recordStreamObservation(account.id, null, observedAt, row.providerStreamId);
      } else {
        await noteLiveCheckFailure(account.id, observedAt);
      }
      refresh();
      return { error: "The provider did not confirm that this broadcast is still live." };
    }
    const outcome = await sendLiveAlert(account.id, row.id, live, true, { channelId, roleId });
    refresh();
    if (outcome === "ALERTED") return { ok: true, message: "Live alert posted." };
    return { error: "No new post was confirmed. Review the updated status below." };
  } catch {
    return { error: "Komu could not finish the recovery. Refresh and check the delivery status." };
  }
}

export async function checkYouTubeBroadcastAction(
  _previous: AlertFormState, form: FormData,
): Promise<AlertFormState> {
  const guild = await requireGuild("/dashboard/alerts");
  const link = String(form.get("link") ?? "");
  if (link.length > 2048) return { error: "Enter a valid YouTube broadcast link." };
  const intent = form.get("intent");
  if (intent !== "track" && intent !== "check") return { error: "Choose a broadcast action." };
  const track = intent === "track";
  try {
    const error = await checkYouTubeBroadcast(guild.id, String(form.get("accountId") ?? ""), link, track);
    if (error) return { error };
    refresh();
    return { ok: true, message: track ? "Broadcast tracking saved." : "YouTube confirmed the live broadcast. See recent alerts for the result." };
  } catch {
    return { error: "Could not verify the broadcast with YouTube. Try again shortly." };
  }
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

  const saved = await prisma.$transaction(async (tx) => {
    const current = await lockStreamAccount(tx, account.id);
    if (!current || current.guildId !== guild.id || current.disconnectedAt) return false;
    await tx.alertConfiguration.upsert({
      where: { streamingAccountId: account.id },
      update: settings,
      create: { streamingAccountId: account.id, guildId: guild.id, ...settings },
    });
    const reason = !settings.enabled ? "ALERTS_OFF" : !settings.channelId ? "NO_CHANNEL" : null;
    const roleId = settings.mentionEnabled ? settings.mentionRoleId : null;
    const affected = {
      stream: { streamingAccountId: account.id, endedAt: null },
      status: "PENDING" as const,
      ...(reason ? {} : { OR: [
        { channelId: null },
        { channelId: { not: settings.channelId } },
        ...(roleId ? [{ roleId: null }, { roleId: { not: roleId } }] : [{ roleId: { not: null } }]),
      ] }),
    };
    await tx.streamAlertDelivery.updateMany({
      where: { ...affected, claim: null },
      data: { status: reason ? "SKIPPED" : "BLOCKED", reason: reason ?? "AUDIENCE_CHANGED" },
    });
    await tx.streamAlertDelivery.updateMany({
      where: { ...affected, claim: { not: null } },
      data: { reason: reason ?? "AUDIENCE_CHANGED" },
    });
    return true;
  });
  if (!saved) return { error: "That channel is no longer connected." };

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
