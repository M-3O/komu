import "server-only";

import { StreamingProvider } from "@prisma/client";

import { TwitchApiError } from "@/lib/twitch/client";
import { twitchAdapter } from "@/lib/twitch/provider";
import { kickAdapter } from "@/lib/kick/provider";
import { youtubeAdapter } from "@/lib/youtube/provider";
import { createLogger } from "@/lib/logger";
import type { StreamingProviderAdapter } from "./types";

/**
 * Provider lookup.
 *
 * Everything outside the `lib/twitch`, `lib/youtube` and `lib/kick` folders
 * goes through here, so adding a provider is a one-line change rather than a
 * hunt through call sites (IMPLEMENTATION_PLAN section 21).
 */

const log = createLogger("stream");

const ADAPTERS: Partial<Record<StreamingProvider, StreamingProviderAdapter>> =
  {
    [StreamingProvider.TWITCH]: twitchAdapter,
    [StreamingProvider.YOUTUBE]: youtubeAdapter,
    [StreamingProvider.KICK]: kickAdapter,
  };

/** The adapter for a provider, or null when it is not implemented yet. */
export function getStreamingProvider(
  provider: StreamingProvider,
): StreamingProviderAdapter | null {
  return ADAPTERS[provider] ?? null;
}

/** Whether a provider is implemented and usable. */
export function isProviderAvailable(provider: StreamingProvider): boolean {
  return getStreamingProvider(provider) !== null;
}

/** Providers that can actually be used right now. */
export function availableProviders(): StreamingProvider[] {
  return Object.keys(ADAPTERS) as StreamingProvider[];
}

/**
 * The adapter for a provider, throwing a clear error when it is missing.
 *
 * Prefer this over `getStreamingProvider` in feature code, so an
 * unimplemented provider fails with an explanation instead of a null
 * dereference.
 */
export function requireStreamingProvider(
  provider: StreamingProvider,
): StreamingProviderAdapter {
  const adapter = getStreamingProvider(provider);

  if (!adapter) {
    log.warn("Provider requested but not implemented", { provider });
    throw new TwitchApiError(
      `${provider} is not supported yet.`,
      undefined,
      "PROVIDER_UNAVAILABLE",
    );
  }

  return adapter;
}

export type { ProviderAccount, StreamInfo, StreamingProviderAdapter } from "./types";