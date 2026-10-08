import "server-only";

import { StreamingProvider } from "@prisma/client";

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { getStreamingProvider } from "./registry";
import type { StreamInfo } from "./types";

/**
 * Live status for a guild's connected channels.
 *
 * This is the Phase 4 deliverable: ask the application whether the creator
 * is live, without any caller knowing which provider is behind it.
 */

const log = createLogger("stream");

export interface ChannelLiveStatus {
  streamingAccountId: string;
  provider: StreamingProvider;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  /** The live stream, or null when offline. */
  stream: StreamInfo | null;
  /**
   * Set when the status could not be determined, for example the provider
   * API was down. Absence of a stream here is not proof the creator is
   * offline, so callers can tell the two apart.
   */
  error?: string;
}

/**
 * Check every connected channel for a guild.
 *
 * One provider being unreachable does not hide the others, so each channel
 * is checked independently and failures are reported per channel
 * (PRD section 12).
 */
export async function getLiveStatuses(
  guildId: string,
): Promise<ChannelLiveStatus[]> {
  const accounts = await prisma.streamingAccount.findMany({
    where: { guildId, disconnectedAt: null },
    select: {
      id: true,
      provider: true,
      providerUserId: true,
      username: true,
      displayName: true,
      avatarUrl: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return Promise.all(accounts.map((account) => checkChannel(account)));
}

/** Check a single channel's live status. */
async function checkChannel(account: {
  id: string;
  provider: StreamingProvider;
  providerUserId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}): Promise<ChannelLiveStatus> {
  const base: ChannelLiveStatus = {
    streamingAccountId: account.id,
    provider: account.provider,
    username: account.username,
    displayName: account.displayName,
    avatarUrl: account.avatarUrl,
    stream: null,
  };

  const adapter = getStreamingProvider(account.provider);

  if (!adapter) {
    return {
      ...base,
      error: `${account.provider} is not supported yet.`,
    };
  }

  try {
    const stream = await adapter.getLiveStream({
      providerUserId: account.providerUserId,
      username: account.username,
      displayName: account.displayName,
      avatarUrl: account.avatarUrl,
    });

    return { ...base, stream };
  } catch (error) {
    log.warn("Could not read live status", {
      streamingAccountId: account.id,
      provider: account.provider,
      reason: error instanceof Error ? error.message : "unknown",
    });

    return {
      ...base,
      error: `Could not reach ${account.provider}. Showing no status.`,
    };
  }
}