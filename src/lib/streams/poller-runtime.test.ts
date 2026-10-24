import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runStreamDetectionCycle } = vi.hoisted(() => ({
  runStreamDetectionCycle: vi.fn(),
}));

vi.mock("./poller", () => ({ runStreamDetectionCycle }));

import { startStreamPoller, stopStreamPoller } from "./poller-runtime";

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
});
