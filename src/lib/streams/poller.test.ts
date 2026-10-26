import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany } = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    streamingAccount: { findMany },
  },
}));

vi.mock("@/lib/discord/rest", () => ({
  sendChannelMessage: vi.fn(),
}));

vi.mock("./registry", () => ({
  getStreamingProvider: vi.fn(),
}));

import { runStreamDetectionCycle } from "./poller";

/**
 * Provider-scoped polling.
 *
 * The in-process timer checks Twitch and Kick every minute but YouTube only
 * every half hour. That is only safe if the cycle actually narrows the
 * database query; a filter applied after loading every channel would still
 * spend the YouTube requests, just later.
 */

const QUIET_CYCLE = {
  checked: 0,
  alerted: 0,
  failed: [],
  skipped: 0,
  unchanged: 0,
};

beforeEach(() => {
  findMany.mockReset();
  findMany.mockResolvedValue([]);
});

describe("stream detection cycle", () => {
  it("checks every provider when no filter is given", async () => {
    await expect(runStreamDetectionCycle()).resolves.toEqual(QUIET_CYCLE);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { disconnectedAt: null },
      }),
    );
  });

  it("filters the query to the requested providers", async () => {
    await runStreamDetectionCycle(["TWITCH", "KICK"]);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          disconnectedAt: null,
          provider: { in: ["TWITCH", "KICK"] },
        },
      }),
    );
  });

  it("treats an empty provider list as every provider", async () => {
    await runStreamDetectionCycle([]);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { disconnectedAt: null },
      }),
    );
  });
});
