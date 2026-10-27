import { StreamingProvider } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runStreamDetectionCycle } = vi.hoisted(() => ({
  runStreamDetectionCycle: vi.fn(),
}));

vi.mock("./poller", () => ({ runStreamDetectionCycle }));

import {
  getStreamPollerStatus,
  startStreamPoller,
  stopStreamPoller,
} from "./poller-runtime";

/**
 * The guard that stops poll cycles stacking.
 *
 * Two overlapping passes cannot double-alert, which is why this was not
 * noticed: correctness held while the provider traffic doubled. A cycle that
 * outlives the interval starts another one, and on YouTube every stacked pass
 * spends 101 quota units looking again at a channel that is already being
 * checked.
 */

const QUIET_CYCLE = {
  checked: 0,
  alerted: 0,
  failed: [],
  skipped: 0,
  unchanged: 0,
};

beforeEach(() => {
  vi.useFakeTimers();
  stopStreamPoller();
  runStreamDetectionCycle.mockReset();
});

afterEach(() => {
  stopStreamPoller();
  vi.useRealTimers();
});

describe("stream poller", () => {
  it("skips a tick while the previous cycle is still running", async () => {
    let finishCycle: (value: typeof QUIET_CYCLE) => void = () => {};

    runStreamDetectionCycle.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCycle = resolve;
        }),
    );

    startStreamPoller(1_000);

    // First pass runs five seconds after start.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(runStreamDetectionCycle).toHaveBeenCalledTimes(1);

    // Two intervals elapse with that cycle still open. Neither may start one.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(runStreamDetectionCycle).toHaveBeenCalledTimes(1);

    // Once it finishes, the next tick is allowed through.
    finishCycle(QUIET_CYCLE);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runStreamDetectionCycle).toHaveBeenCalledTimes(2);
  });

  it("keeps polling after a cycle throws", async () => {
    runStreamDetectionCycle
      .mockRejectedValueOnce(new Error("provider exploded"))
      .mockResolvedValue(QUIET_CYCLE);

    startStreamPoller(1_000);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(runStreamDetectionCycle).toHaveBeenCalledTimes(1);

    // A failed cycle must release the guard, or polling stops for good.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runStreamDetectionCycle).toHaveBeenCalledTimes(2);
  });

  it("does not register a second timer", async () => {
    runStreamDetectionCycle.mockResolvedValue(QUIET_CYCLE);

    startStreamPoller(1_000);
    startStreamPoller(1_000);

    // Two intervals would mean two passes per tick: four calls, not two.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(runStreamDetectionCycle).toHaveBeenCalledTimes(2);
  });

  it("polls separate provider groups on independent timers", async () => {
    const pending: Array<(value: typeof QUIET_CYCLE) => void> = [];

    runStreamDetectionCycle.mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    );

    startStreamPoller(1_000, {
      key: "fast",
      providers: [StreamingProvider.TWITCH, StreamingProvider.KICK],
    });
    startStreamPoller(2_000, {
      key: "youtube",
      providers: [StreamingProvider.YOUTUBE],
    });

    // A slow cycle in one group must not suppress the other group's first
    // tick. Both promises are intentionally unresolved here.
    await vi.advanceTimersByTimeAsync(5_000);

    expect(runStreamDetectionCycle).toHaveBeenCalledTimes(2);
    expect(runStreamDetectionCycle.mock.calls[0]?.[0]).toEqual([
      StreamingProvider.TWITCH,
      StreamingProvider.KICK,
    ]);
    expect(runStreamDetectionCycle.mock.calls[1]?.[0]).toEqual([
      StreamingProvider.YOUTUBE,
    ]);

    for (const resolve of pending) resolve(QUIET_CYCLE);
  });

  it("stops only the named poller when one is given", async () => {
    runStreamDetectionCycle.mockResolvedValue(QUIET_CYCLE);

    startStreamPoller(1_000, {
      key: "fast",
      providers: [StreamingProvider.TWITCH],
    });
    startStreamPoller(1_000, {
      key: "youtube",
      providers: [StreamingProvider.YOUTUBE],
    });

    stopStreamPoller("fast");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(runStreamDetectionCycle).toHaveBeenCalledTimes(1);
    expect(runStreamDetectionCycle.mock.calls[0]?.[0]).toEqual([
      StreamingProvider.YOUTUBE,
    ]);
  });

  it("reports each poller's interval, providers and last result", async () => {
    runStreamDetectionCycle.mockResolvedValue(QUIET_CYCLE);

    startStreamPoller(1_000, {
      key: "fast",
      providers: [StreamingProvider.TWITCH, StreamingProvider.KICK],
    });

    await vi.advanceTimersByTimeAsync(1_000);

    const [status] = getStreamPollerStatus();

    expect(status).toMatchObject({
      key: "fast",
      intervalMs: 1_000,
      providers: [StreamingProvider.TWITCH, StreamingProvider.KICK],
      inFlight: false,
      lastResult: QUIET_CYCLE,
      lastError: null,
    });
    expect(status?.registeredAt).toEqual(expect.any(String));
    expect(status?.lastStartedAt).toEqual(expect.any(String));
    expect(status?.lastFinishedAt).toEqual(expect.any(String));
  });

  it("reports an in-flight cycle and its final state", async () => {
    let finishCycle: (value: typeof QUIET_CYCLE) => void = () => {};

    runStreamDetectionCycle.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCycle = resolve;
        }),
    );

    startStreamPoller(1_000, { key: "fast" });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(getStreamPollerStatus()[0]).toMatchObject({
      inFlight: true,
      lastStartedAt: expect.any(String),
      lastFinishedAt: null,
    });

    finishCycle(QUIET_CYCLE);
    await vi.advanceTimersByTimeAsync(0);

    expect(getStreamPollerStatus()[0]).toMatchObject({
      inFlight: false,
      lastResult: QUIET_CYCLE,
      lastFinishedAt: expect.any(String),
    });
  });

  it("reports the last cycle error", async () => {
    runStreamDetectionCycle.mockRejectedValue(new Error("provider exploded"));

    startStreamPoller(1_000, { key: "fast" });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(getStreamPollerStatus()[0]).toMatchObject({
      inFlight: false,
      lastResult: null,
      lastError: "provider exploded",
      lastFinishedAt: expect.any(String),
    });
  });

  it("reports no pollers after they are stopped", () => {
    startStreamPoller(1_000, { key: "fast" });
    stopStreamPoller();

    expect(getStreamPollerStatus()).toEqual([]);
  });
});
