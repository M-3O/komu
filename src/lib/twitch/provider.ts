import "server-only";

import { StreamingProvider } from "@prisma/client";

import {
  getStreamsByUserId,
  getUsersById,
  getUsersByLogin,
} from "./client";
import { buildChannelUrl, pickLiveStream } from "./normalize";
import type {
  ProviderAccount,
  StreamInfo,
  StreamingProviderAdapter,
} from "@/lib/streams/types";

/**
 * Twitch implementation of the provider interface.
 *
 * Callers get `StreamInfo`, never a Helix response. YouTube and Kick follow
 * this same shape (IMPLEMENTATION_PLAN section 4).
 */
export const twitchAdapter: StreamingProviderAdapter = {
  provider: StreamingProvider.TWITCH,

  async getAccount(identifier: string): Promise<ProviderAccount | null> {
    const trimmed = identifier.trim();
    if (!trimmed) return null;

    // Twitch logins are case-insensitive and always lowercase in responses.
    const login = trimmed.toLowerCase();

    // A numeric identifier is treated as a user id, which is what the
    // database stores once an account has been connected.
    const users = /^\d+$/.test(login)
      ? await getUsersById([login])
      : await getUsersByLogin([login]);

    const user = users[0];
    if (!user) return null;

    return {
      providerUserId: user.id,
      username: user.login,
      displayName: user.display_name || user.login,
      avatarUrl: user.profile_image_url || null,
    };
  },

  async getLiveStream(account: ProviderAccount): Promise<StreamInfo | null> {
    const streams = await getStreamsByUserId([account.providerUserId]);

    // An empty response is Twitch saying "offline", which is a normal
    // outcome rather than a failure.
    const normalized = pickLiveStream(streams, account.providerUserId);
    if (!normalized) return null;

    return { provider: StreamingProvider.TWITCH, ...normalized };
  },

  async isLive(account: ProviderAccount): Promise<boolean> {
    const streams = await getStreamsByUserId([account.providerUserId]);
    return streams.some((stream) => stream.user_id === account.providerUserId);
  },
};

export { buildChannelUrl };