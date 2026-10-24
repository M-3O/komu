"use server";

import { StreamingProvider } from "@prisma/client";
import { refresh } from "next/cache";

import { requireGuild } from "@/lib/dashboard/require-guild";
import { createLogger } from "@/lib/logger";
import {
  connectStreamingAccount,
  disconnectStreamingAccount,
} from "@/lib/streams/connect-account";

/**
 * Channel management actions.
 *
 * The provider and identifier arrive from the browser, so both are validated
 * here rather than trusted: the provider must be one Komu supports, and the
 * identifier is resolved through the provider before anything is written.
 */

const log = createLogger("stream");

const SUPPORTED_PROVIDERS: StreamingProvider[] = [StreamingProvider.TWITCH];

/** The single connected server, which every account is scoped to. */
async function requireGuildId(): Promise<string> {
  const guild = await requireGuild("/dashboard/streams");
  return guild.id;
}

function isSupportedProvider(value: string): value is StreamingProvider {
  return SUPPORTED_PROVIDERS.includes(value as StreamingProvider);
}

export interface ChannelActionResult {
  ok: boolean;
  error?: string;
}

export async function connectChannelAction(
  provider: string,
  identifier: string,
): Promise<ChannelActionResult> {
  if (!isSupportedProvider(provider)) {
    return { ok: false, error: `${provider} is not supported yet.` };
  }

  const guildId = await requireGuildId();
  const result = await connectStreamingAccount(guildId, provider, identifier);

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  // The channel list is a Server Component reading the database, and a Server
  // Action only re-renders the current route when it asks for it. Without
  // this the write succeeds and the page keeps showing the old list, so the
  // channel appears to have been ignored.
  refresh();

  return { ok: true };
}

export async function disconnectChannelAction(
  streamingAccountId: string,
): Promise<ChannelActionResult> {
  const guildId = await requireGuildId();
  const result = await disconnectStreamingAccount(guildId, streamingAccountId);

  if (result.ok) {
    log.info("Channel disconnected from dashboard", { streamingAccountId });
    refresh();
  }

  return result.ok ? { ok: true } : { ok: false, error: result.error };
}