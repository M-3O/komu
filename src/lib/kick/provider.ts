import "server-only";

import { StreamingProvider } from "@prisma/client";

import type {
  ProviderAccount,
  StreamInfo,
  StreamingProviderAdapter,
} from "@/lib/streams/types";
import { getChannel } from "./client";
import {
  normalizeChannel,
  normalizeLivestream,
  parseChannelIdentifier,
} from "./normalize";

/**
 * Kick implementation of the provider interface.
 *
 * Same shape as the Twitch and YouTube adapters. Kick needs only one request
 * per check, because the channel response already carries the livestream when
 * the channel is live.
 */
export const kickAdapter: StreamingProviderAdapter = {
  provider: StreamingProvider.KICK,

  async getAccount(identifier: string): Promise<ProviderAccount | null> {
    const slug = parseChannelIdentifier(identifier);

    if (!slug) return null;

    const channel = await getChannel(slug);

    if (!channel) return null;

    return normalizeChannel(channel);
  },

  async getLiveStream(account: ProviderAccount): Promise<StreamInfo | null> {
    const channel = await getChannel(account.username);

    if (!channel) return null;

    const normalized = normalizeLivestream(channel, account);

    if (!normalized) return null;

    return { provider: StreamingProvider.KICK, ...normalized };
  },

  async isLive(account: ProviderAccount): Promise<boolean> {
    const channel = await getChannel(account.username);

    return normalizeLivestream(channel ?? {}, account) !== null;
  },
};

export { buildChannelUrl } from "./normalize";