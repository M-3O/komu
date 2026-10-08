import "server-only";

import { StreamingProvider } from "@prisma/client";

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { requireStreamingProvider } from "@/lib/streams/registry";

/**
 * Connecting and disconnecting creator accounts.
 *
 * The identifier a creator types (a Twitch login, a YouTube channel id) is
 * untrusted input. It is resolved through the provider before anything is
 * written, so Komu stores the provider's own ids and display name rather
 * than what was typed.
 */

const log = createLogger("stream");

export interface ConnectAccountResult {
  ok: boolean;
  /** Present when ok is false. Safe to show on the dashboard. */
  error?: string;
  /** Present when ok is true. */
  account?: {
    id: string;
    provider: StreamingProvider;
    username: string;
    displayName: string | null;
  };
}

/**
 * Look up a channel with the provider and store it against the guild.
 *
 * Re-connecting the same channel updates the stored row instead of creating
 * a duplicate.
 */
export async function connectStreamingAccount(
  guildId: string,
  provider: StreamingProvider,
  identifier: string,
): Promise<ConnectAccountResult> {
  const adapter = requireStreamingProvider(provider);
  const trimmed = identifier.trim();

  if (!trimmed) {
    return { ok: false, error: "Enter a channel name or id." };
  }

  let resolved;
  try {
    resolved = await adapter.getAccount(trimmed);
  } catch (error) {
    log.error("Provider lookup failed while connecting", {
      provider,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return {
      ok: false,
      error: `Could not reach ${provider}. Try again in a moment.`,
    };
  }

  // An empty result means the channel does not exist, which is a typo rather
  // than an outage.
  if (!resolved) {
    return {
      ok: false,
      error: `No ${provider} channel found for "${trimmed}".`,
    };
  }

  try {
    const account = await prisma.streamingAccount.upsert({
      where: {
        guildId_provider_providerUserId: {
          guildId,
          provider,
          providerUserId: resolved.providerUserId,
        },
      },
      update: {
        username: resolved.username,
        displayName: resolved.displayName,
        avatarUrl: resolved.avatarUrl,
        disconnectedAt: null,
      },
      create: {
        guildId,
        provider,
        providerUserId: resolved.providerUserId,
        username: resolved.username,
        displayName: resolved.displayName,
        avatarUrl: resolved.avatarUrl,
      },
      select: {
        id: true,
        provider: true,
        username: true,
        displayName: true,
      },
    });

    log.info("Connected streaming account", {
      guildId,
      provider,
      providerUserId: resolved.providerUserId,
    });

    return { ok: true, account };
  } catch (error) {
    log.error("Could not store streaming account", {
      guildId,
      provider,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return { ok: false, error: "Could not save that channel. Try again." };
  }
}

/**
 * Disconnect a channel.
 *
 * The account row is kept rather than deleted, so past streams and their
 * attendance records stay intact.
 */
export async function disconnectStreamingAccount(
  guildId: string,
  streamingAccountId: string,
): Promise<ConnectAccountResult> {
  const account = await prisma.streamingAccount.findFirst({
    where: { id: streamingAccountId, guildId },
    select: { id: true, provider: true, username: true, displayName: true },
  });

  if (!account) {
    return { ok: false, error: "That channel is not connected." };
  }

  await prisma.streamingAccount.update({
    where: { id: account.id },
    data: { disconnectedAt: new Date() },
  });

  log.info("Disconnected streaming account", {
    guildId,
    streamingAccountId: account.id,
    provider: account.provider,
  });

  return { ok: true, account };
}