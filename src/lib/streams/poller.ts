import "server-only";

import { prisma } from "@/lib/db";
import { sendChannelMessage } from "@/lib/discord/rest";
import { createLogger } from "@/lib/logger";
import {
  buildAlertMessage,
  type AlertSettings,
} from "./build-alert-message";
import { decideAlertAction, type KnownSession } from "./decide-alert";
import { getStreamingProvider } from "./registry";
import type { StreamInfo } from "./types";

/**
 * The V1 polling mechanism.
 *
 * One pass of this is a complete detection cycle: look at every connected
 * channel, decide whether anything changed, and act. It is deliberately
 * self-contained and idempotent, so the trigger can be swapped later for
 * provider webhooks or a real job system without touching the rest of the
 * app (IMPLEMENTATION_PLAN section 8).
 *
 * Nothing here schedules itself. See `app/api/internal/poll-streams` for the
 * trigger, and `instrumentation.ts` for the optional in-process timer.
 */

const log = createLogger("stream");

export interface CycleResult {
  /** Channels examined. */
  checked: number;
  /** Alerts successfully posted. */
  alerted: number;
  /** Alerts that failed, with the reason. */
  failed: Array<{ channel: string; reason: string }>;
  /** Channels whose status could not be read. */
  skipped: number;
  /** Channels whose status was read but produced nothing to do. */
  unchanged: number;
}

/** Alert settings plus the ids the cycle needs. */
interface AlertableChannel {
  streamingAccountId: string;
  guildId: string;
  provider: StreamInfo["provider"];
  providerUserId: string;
  username: string;
  displayName: string | null;
  settings: AlertSettings | null;
}

/**
 * Run one detection pass.
 *
 * Safe to run concurrently: the `Stream` table has a unique constraint on
 * (streamingAccountId, providerStreamId), so two overlapping passes cannot
 * both create the same session.
 */
export async function runStreamDetectionCycle(): Promise<CycleResult> {
  const result: CycleResult = {
    checked: 0,
    alerted: 0,
    failed: [],
    skipped: 0,
    unchanged: 0,
  };

  const channels = await loadAlertableChannels();

  for (const channel of channels) {
    result.checked += 1;

    try {
      const outcome = await processChannel(channel);
      if (outcome === "ALERTED") result.alerted += 1;
      else if (outcome === "SKIPPED") result.skipped += 1;
      else result.unchanged += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown";
      log.error("Detection cycle failed for a channel", {
        streamingAccountId: channel.streamingAccountId,
        provider: channel.provider,
        reason,
      });
      result.skipped += 1;
    }
  }

  return result;
}

type ChannelOutcome = "ALERTED" | "UNCHANGED" | "SKIPPED";

async function processChannel(channel: AlertableChannel): Promise<ChannelOutcome> {
  const adapter = getStreamingProvider(channel.provider);

  if (!adapter) {
    log.warn("No adapter for provider", { provider: channel.provider });
    return "SKIPPED";
  }

  let stream: StreamInfo | null;

  try {
    stream = await adapter.getLiveStream({
      providerUserId: channel.providerUserId,
      username: channel.username,
      displayName: channel.displayName,
      avatarUrl: null,
    });
  } catch (error) {
    // Provider unavailable. Leave the existing session alone rather than
    // closing it, so a brief outage does not look like the stream ended.
    log.warn("Could not read live status during detection", {
      streamingAccountId: channel.streamingAccountId,
      provider: channel.provider,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return "SKIPPED";
  }

  const known = await loadLatestSession(channel.streamingAccountId);
  const decision = decideAlertAction(stream, known);

  if (decision.action === "CLOSE_SESSION") {
    if (decision.providerStreamId) {
      await closeSession(
        channel.streamingAccountId,
        decision.providerStreamId,
      );
      log.info("Stream ended", {
        streamingAccountId: channel.streamingAccountId,
        providerStreamId: decision.providerStreamId,
      });
    }
    return "UNCHANGED";
  }

  if (decision.action === "SKIP_ALREADY_ALERTED") {
    return "UNCHANGED";
  }

  // A new session. Record it first, then send. Recording first means a crash
  // between the two loses an alert rather than sending duplicates later.
  const liveStream = decision.stream;
  const session = await recordSession(channel, liveStream);

  if (!session.created || !session.id) {
    // Another pass created it first.
    return "UNCHANGED";
  }

  if (!channel.settings) {
    log.info("New stream found but alerts are not configured", {
      streamingAccountId: channel.streamingAccountId,
      providerStreamId: liveStream.providerStreamId,
    });
    return "UNCHANGED";
  }

  const sent = await deliverAlert(channel, liveStream, session.id);
  return sent ? "ALERTED" : "UNCHANGED";
}

/**
 * Post the alert and mark the session as announced.
 *
 * Marking happens only on success, so a failed send is retried on the next
 * pass instead of being silently lost.
 */
async function deliverAlert(
  channel: AlertableChannel,
  stream: StreamInfo,
  streamRowId: string,
): Promise<boolean> {
  const settings = channel.settings;

  if (!settings?.channelId) {
    log.warn("Alert channel not set", {
      streamingAccountId: channel.streamingAccountId,
    });
    return false;
  }

  const creatorName = channel.displayName ?? channel.username;
  const message = buildAlertMessage({ stream, settings, creatorName });

  if (message.error) {
    log.warn("Cannot build alert", {
      streamingAccountId: channel.streamingAccountId,
      reason: message.error,
    });
    return false;
  }

  const result = await sendChannelMessage(settings.channelId, {
    content: message.content,
    embeds: message.embeds,
    components: message.components,
  });

  if (!result.ok) {
    log.warn("Alert could not be delivered", {
      streamingAccountId: channel.streamingAccountId,
      channelId: settings.channelId,
      code: result.code,
      reason: result.error,
    });
    return false;
  }

  // Only now record that this session was announced. Doing it after the
  // send means a failure is retried rather than lost.
  await prisma.stream.update({
    where: { id: streamRowId },
    data: {
      alertSentAt: new Date(),
      // Stored so a reaction on the alert can be matched back to this
      // session, which is how attendance is counted.
      alertMessageId: result.messageId ?? null,
    },
  });

  log.info("Live alert sent", {
    streamingAccountId: channel.streamingAccountId,
    provider: channel.provider,
    channelId: settings.channelId,
    providerStreamId: stream.providerStreamId,
  });

  return true;
}

/**
 * Load every channel that has alerts enabled.
 *
 * Channels without a configured alert channel are still tracked for session
 * history, so a creator who configures alerts later still has past streams.
 */
async function loadAlertableChannels(): Promise<AlertableChannel[]> {
  const accounts = await prisma.streamingAccount.findMany({
    where: { disconnectedAt: null },
    select: {
      id: true,
      guildId: true,
      provider: true,
      providerUserId: true,
      username: true,
      displayName: true,
      alertConfig: {
        select: {
          channelId: true,
          mentionRoleId: true,
          mentionEnabled: true,
          messageMode: true,
          customMessage: true,
          embedEnabled: true,
          embedColor: true,
          showThumbnail: true,
          showViewerCount: true,
          showGame: true,
          watchButtonEnabled: true,
          watchButtonLabel: true,
        },
      },
    },
  });

  return accounts.map((account) => ({
    streamingAccountId: account.id,
    guildId: account.guildId,
    provider: account.provider,
    providerUserId: account.providerUserId,
    username: account.username,
    displayName: account.displayName,
    settings: account.alertConfig,
  }));
}

/** The most recent recorded session for a channel. */
async function loadLatestSession(
  streamingAccountId: string,
): Promise<KnownSession | null> {
  const session = await prisma.stream.findFirst({
    where: { streamingAccountId },
    orderBy: { startedAt: "desc" },
    select: { providerStreamId: true, alertSentAt: true, endedAt: true },
  });

  return session;
}

/**
 * Record a new live session.
 *
 * Returns `created: false` when the unique constraint rejects it, which is
 * how an overlapping detection pass is detected without a lock.
 */
async function recordSession(
  channel: AlertableChannel,
  stream: StreamInfo,
): Promise<{ created: boolean; id: string | null }> {
  try {
    const row = await prisma.stream.create({
      data: {
        guildId: channel.guildId,
        streamingAccountId: channel.streamingAccountId,
        providerStreamId: stream.providerStreamId,
        title: stream.title ?? "",
        game: stream.game,
        thumbnailUrl: stream.thumbnail,
        viewerCount: stream.viewerCount,
        startedAt: stream.startedAt ?? new Date(),
      },
      select: { id: true },
    });

    return { created: true, id: row.id };
  } catch (error) {
    // Prisma surfaces a unique violation as P2002.
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "P2002"
    ) {
      return { created: false, id: null };
    }
    throw error;
  }
}

/** Mark a session as finished. */
async function closeSession(
  streamingAccountId: string,
  providerStreamId: string,
): Promise<void> {
  await prisma.stream
    .update({
      where: {
        streamingAccountId_providerStreamId: {
          streamingAccountId,
          providerStreamId,
        },
      },
      data: { endedAt: new Date() },
    })
    .catch(() => undefined);
}