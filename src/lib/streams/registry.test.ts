import { describe, expect, it } from "vitest";

import { availableProviders, getStreamingProvider, isProviderAvailable } from "./registry";
import { StreamingProvider } from "@prisma/client";

/**
 * The registry is the only place feature code should reach a provider
 * through, so these checks guard the lookup itself rather than any provider.
 */
describe("provider registry", () => {
  it("resolves Twitch", () => {
    expect(getStreamingProvider(StreamingProvider.TWITCH)).not.toBeNull();
    expect(isProviderAvailable(StreamingProvider.TWITCH)).toBe(true);
  });

  it("returns null for providers that are not implemented yet", () => {
    // YouTube and Kick arrive later in Phase 4.
    expect(getStreamingProvider(StreamingProvider.YOUTUBE)).toBeNull();
    expect(getStreamingProvider(StreamingProvider.KICK)).toBeNull();
    expect(isProviderAvailable(StreamingProvider.YOUTUBE)).toBe(false);
  });

  it("lists only implemented providers", () => {
    expect(availableProviders()).toEqual([StreamingProvider.TWITCH]);
  });

  it("exposes the provider on its own adapter", () => {
    expect(getStreamingProvider(StreamingProvider.TWITCH)?.provider).toBe(
      StreamingProvider.TWITCH,
    );
  });
});