import "server-only";

import { StreamingProvider } from "@prisma/client";

import type {
  ProviderAccount,
  StreamInfo,
  StreamingProviderAdapter,
} from "@/lib/streams/types";
import {
  getChannelByHandle,
  getChannelById,
  getLiveVideo,
  getVideo,
} from "./client";
import {
  isChannelId,
  normalizeChannel,
  normalizeLiveStream,
  parseChannelIdentifier,
  pickLiveVideoId,
} from "./normalize";

/**
 * YouTube implementation of the provider interface.
 *
 * Same shape as the Twitch adapter, so nothing downstream knows which provider
 * a stream came from.
 */
export const youtubeAdapter: StreamingProviderAdapter = {
  provider: StreamingProvider.YOUTUBE,

  async getAccount(identifier: string): Promise<ProviderAccount | null> {
    const parsed = parseChannelIdentifier(identifier);

    if (!parsed) return null;

    // Once connected, a channel id is what gets stored, and the id path is the
    // only one that cannot drift if a creator changes their handle.
    const channels = isChannelId(parsed)
      ? await getChannelById(parsed)
      : await getChannelByHandle(parsed);

    return normalizeChannel(channels[0] ?? {});
  },

  async getLiveStream(account: ProviderAccount): Promise<StreamInfo | null> {
    const search = await getLiveVideo(account.providerUserId);

    // An empty response is YouTube saying "offline", a normal outcome.
    const videoId = pickLiveVideoId(search);

    if (!videoId) return null;

    const videos = await getVideo(videoId);
    const normalized = normalizeLiveStream(videos[0] ?? {});

    if (!normalized) return null;

    // The search response already told us this channel, so the video's own
    // channel fields are only used for display.
    return {
      provider: StreamingProvider.YOUTUBE,
      ...normalized,
      creatorId: account.providerUserId,
      creatorUsername: account.providerUserId,
      creatorDisplayName: account.displayName ?? normalized.creatorDisplayName,
    };
  },

  async isLive(account: ProviderAccount): Promise<boolean> {
    // The cheap check. `normalizeLiveStream` is what distinguishes a finished
    // broadcast from a running one, and that needs the second request, so the
    // honest version of this is the full path.
    const search = await getLiveVideo(account.providerUserId);

    return pickLiveVideoId(search) !== null;
  },
};

export { buildChannelUrl, buildWatchUrl } from "./normalize";