import { describe, expect, it } from "vitest";

import {
  detectSpike,
  exceeded,
  joinKey,
  messageKey,
  SlidingWindow,
} from "./rate-limit";

/**
 * Rate and spike detection.
 *
 * The window is supplied explicitly, so these run without a clock and without
 * sleeping.
 */

const NOW = 1_700_000_000_000;

describe("SlidingWindow", () => {
  it("counts nothing before anything is recorded", () => {
    const window = new SlidingWindow();
    expect(window.count("a", NOW, 10_000)).toBe(0);
  });

  it("counts what it has recorded", () => {
    const window = new SlidingWindow();

    window.record("a", NOW - 3_000, 10_000);
    window.record("a", NOW - 2_000, 10_000);
    window.record("a", NOW - 1_000, 10_000);

    expect(window.count("a", NOW, 10_000)).toBe(3);
  });

  it("forgets events that fall out of the window", () => {
    const window = new SlidingWindow();

    window.record("a", NOW - 30_000, 10_000);
    window.record("a", NOW - 1_000, 10_000);

    expect(window.count("a", NOW, 10_000)).toBe(1);
  });

  it("keeps keys apart", () => {
    const window = new SlidingWindow();

    window.record("a", NOW, 10_000);
    window.record("b", NOW, 10_000);

    expect(window.count("a", NOW, 10_000)).toBe(1);
    expect(window.count("b", NOW, 10_000)).toBe(1);
  });

  it("clears one key without touching the others", () => {
    const window = new SlidingWindow();

    window.record("a", NOW, 10_000);
    window.record("b", NOW, 10_000);

    window.clear("a");

    expect(window.count("a", NOW, 10_000)).toBe(0);
    expect(window.count("b", NOW, 10_000)).toBe(1);
  });

  it("clears everything", () => {
    const window = new SlidingWindow();

    window.record("a", NOW, 10_000);
    window.record("b", NOW, 10_000);

    window.clearAll();

    expect(window.count("a", NOW, 10_000)).toBe(0);
    expect(window.count("b", NOW, 10_000)).toBe(0);
  });

  it("bounds how much one key can hold", () => {
    const window = new SlidingWindow();

    // A far tighter window than the cap allows, so every record is a fresh
    // one that would otherwise pile up.
    for (let i = 0; i < 200; i++) {
      window.record("a", NOW - 200 + i, 10_000_000);
    }

    expect(window.count("a", NOW, 10_000_000)).toBeLessThanOrEqual(32);
  });

  it("drops keys with nothing left in the window when pruned", () => {
    const window = new SlidingWindow();

    window.record("a", NOW - 60_000, 10_000);
    window.record("b", NOW, 10_000);

    window.prune(NOW, 10_000);

    // "a" is gone, "b" survives.
    expect(window.count("a", NOW, 10_000)).toBe(0);
    expect(window.count("b", NOW, 10_000)).toBe(1);
  });
});

describe("exceeded", () => {
  it("is false at the limit", () => {
    expect(exceeded({ limit: 5, windowMs: 1000 }, 5)).toBe(false);
  });

  it("is true one past the limit", () => {
    expect(exceeded({ limit: 5, windowMs: 1000 }, 6)).toBe(true);
  });

  it("is false at zero, whatever the limit", () => {
    expect(exceeded({ limit: 0, windowMs: 1000 }, 0)).toBe(false);
  });

  it("is true with a zero limit on the first event", () => {
    // A rule of "no messages allowed" should stop the first one.
    expect(exceeded({ limit: 0, windowMs: 1000 }, 1)).toBe(true);
  });
});

describe("detectSpike", () => {
  const rule = { limit: 3, windowMs: 60_000 };

  it("does not trip below the threshold", () => {
    const events = [{ at: NOW - 30_000 }, { at: NOW - 20_000 }];
    expect(detectSpike(events, rule, NOW).tripped).toBe(false);
  });

  it("does not trip at exactly the threshold", () => {
    const events = [
      { at: NOW - 30_000 },
      { at: NOW - 20_000 },
      { at: NOW - 10_000 },
    ];

    expect(detectSpike(events, rule, NOW).tripped).toBe(false);
  });

  it("trips one past the threshold", () => {
    const events = [
      { at: NOW - 30_000 },
      { at: NOW - 20_000 },
      { at: NOW - 10_000 },
      { at: NOW - 1_000 },
    ];

    expect(detectSpike(events, rule, NOW).tripped).toBe(true);
  });

  it("ignores joins outside the window", () => {
    // Four joins, but all long enough ago to be irrelevant now.
    const events = [
      { at: NOW - 600_000 },
      { at: NOW - 500_000 },
      { at: NOW - 400_000 },
      { at: NOW - 300_000 },
    ];

    expect(detectSpike(events, rule, NOW).tripped).toBe(false);
  });

  it("returns the events inside the window", () => {
    const events = [
      { at: NOW - 600_000 },
      { at: NOW - 5_000, id: "recent-1" },
      { at: NOW - 1_000, id: "recent-2" },
    ];

    const result = detectSpike(events, rule, NOW);

    expect(result.events.map((event) => (event as { id?: string }).id)).toEqual([
      "recent-1",
      "recent-2",
    ]);
  });

  it("does not trip on no events at all", () => {
    expect(detectSpike([], rule, NOW).tripped).toBe(false);
  });
});


describe("keys", () => {
  it("keeps a member's messages apart from a guild's joins", () => {
    expect(messageKey("g1", "m1")).not.toBe(joinKey("g1"));
  });

  it("keeps members apart within a guild", () => {
    expect(messageKey("g1", "m1")).not.toBe(messageKey("g1", "m2"));
  });

  it("keeps guilds apart", () => {
    expect(messageKey("g1", "m1")).not.toBe(messageKey("g2", "m1"));
    expect(joinKey("g1")).not.toBe(joinKey("g2"));
  });
});
