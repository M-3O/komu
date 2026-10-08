import { describe, expect, it } from "vitest";

import { availableProviders, getStreamingProvider, isProviderAvailable } from "./registry";
import { StreamingProvider } from "@prisma/client";

/**
 * The registry is the only place feature code should reach a provider
 * through, so these checks guard the lookup itself rather than any provider.
 *
 * All three V1 providers are implemented. This file was written when only
 * Twitch existed and asserted the other two were absent; the two assertions it
 * got wrong failed the moment they landed, which is the point of having it.
 */

const IMPLEMENTED = [
  StreamingProvider.TWITCH,
  StreamingProvider.YOUTUBE,
  StreamingProvider.KICK,
];

describe("provider registry", () => {
  it("resolves every implemented provider", () => {
    for (const provider of IMPLEMENTED) {
      expect(getStreamingProvider(provider)).not.toBeNull();
      expect(isProviderAvailable(provider)).toBe(true);
    }
  });

  it("lists exactly the implemented providers", () => {
    expect(availableProviders().sort()).toEqual([...IMPLEMENTED].sort());
  });

  it("exposes each adapter's own provider", () => {
    // A copy-paste slip returning the wrong adapter would otherwise go
    // unnoticed until alerts said "Twitch" for a YouTube stream.
    for (const provider of IMPLEMENTED) {
      expect(getStreamingProvider(provider)?.provider).toBe(provider);
    }
  });

  it("gives every adapter the three methods the interface requires", () => {
    for (const provider of IMPLEMENTED) {
      const adapter = getStreamingProvider(provider);

      expect(typeof adapter?.getAccount).toBe("function");
      expect(typeof adapter?.getLiveStream).toBe("function");
      expect(typeof adapter?.isLive).toBe("function");
    }
  });

  it("returns null for a provider that does not exist", () => {
    expect(getStreamingProvider("NOT_A_PROVIDER" as StreamingProvider)).toBeNull();
    expect(isProviderAvailable("NOT_A_PROVIDER" as StreamingProvider)).toBe(false);
  });
});