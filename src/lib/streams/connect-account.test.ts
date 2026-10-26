import { beforeEach, describe, expect, it, vi } from "vitest";

import { StreamingProvider } from "@prisma/client";

const { getAccountMock, upsertMock } = vi.hoisted(() => ({
  getAccountMock: vi.fn(),
  upsertMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    streamingAccount: {
      upsert: upsertMock,
    },
  },
}));

vi.mock("./registry", () => ({
  requireStreamingProvider: () => ({ getAccount: getAccountMock }),
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { connectStreamingAccount } from "./connect-account";

/**
 * Connecting is the one place a provider's own error message reaches the
 * dashboard. A missing API key and a network outage both arrive here as
 * exceptions, and telling them apart is what keeps the fix obvious.
 */

const account = {
  providerUserId: "yt-1",
  username: "creator",
  displayName: "Creator",
  avatarUrl: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("connectStreamingAccount", () => {
  it("rejects an empty identifier before calling the provider", async () => {
    const result = await connectStreamingAccount(
      "guild-1",
      StreamingProvider.YOUTUBE,
      "   ",
    );

    expect(result).toEqual({ ok: false, error: "Enter a channel name or id." });
    expect(getAccountMock).not.toHaveBeenCalled();
  });

  it("surfaces a missing API key instead of reporting an outage", async () => {
    getAccountMock.mockRejectedValue(
      Object.assign(
        new Error(
          "YouTube is not configured. Add YOUTUBE_CLIENT_ID to .env.local.",
        ),
        { code: "NOT_CONFIGURED" },
      ),
    );

    const result = await connectStreamingAccount(
      "guild-1",
      StreamingProvider.YOUTUBE,
      "UC123",
    );

    expect(result).toEqual({
      ok: false,
      error: "YouTube is not configured. Add YOUTUBE_CLIENT_ID to .env.local.",
    });
  });

  it("keeps a genuine outage generic", async () => {
    getAccountMock.mockRejectedValue(new Error("socket hang up"));

    const result = await connectStreamingAccount(
      "guild-1",
      StreamingProvider.KICK,
      "creator",
    );

    expect(result).toEqual({
      ok: false,
      error: "Could not reach KICK. Try again in a moment.",
    });
  });

  it("reports an unknown channel as a typo, not an outage", async () => {
    getAccountMock.mockResolvedValue(null);

    const result = await connectStreamingAccount(
      "guild-1",
      StreamingProvider.KICK,
      "nobody",
    );

    expect(result).toEqual({
      ok: false,
      error: 'No KICK channel found for "nobody".',
    });
  });

  it("stores the provider's identity rather than the typed identifier", async () => {
    getAccountMock.mockResolvedValue(account);
    upsertMock.mockResolvedValue({
      id: "acct-1",
      provider: StreamingProvider.YOUTUBE,
      username: account.username,
      displayName: account.displayName,
    });

    const result = await connectStreamingAccount(
      "guild-1",
      StreamingProvider.YOUTUBE,
      "  @creator  ",
    );

    expect(getAccountMock).toHaveBeenCalledWith("@creator");
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          guildId_provider_providerUserId: {
            guildId: "guild-1",
            provider: StreamingProvider.YOUTUBE,
            providerUserId: "yt-1",
          },
        },
        create: expect.objectContaining({
          providerUserId: "yt-1",
          username: "creator",
        }),
      }),
    );
    expect(result).toEqual({
      ok: true,
      account: {
        id: "acct-1",
        provider: StreamingProvider.YOUTUBE,
        username: "creator",
        displayName: "Creator",
      },
    });
  });

  it("turns a storage failure into a plain retry message", async () => {
    getAccountMock.mockResolvedValue(account);
    upsertMock.mockRejectedValue(new Error("unique constraint"));

    const result = await connectStreamingAccount(
      "guild-1",
      StreamingProvider.YOUTUBE,
      "@creator",
    );

    expect(result).toEqual({
      ok: false,
      error: "Could not save that channel. Try again.",
    });
  });
});
