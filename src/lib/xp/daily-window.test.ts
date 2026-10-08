import { describe, expect, it } from "vitest";

import { applyDailyCap, dailyWindow, startOfUtcDay } from "./daily-window";

describe("startOfUtcDay", () => {
  it("strips the time part", () => {
    const result = startOfUtcDay(new Date("2024-05-17T13:45:12Z"));

    expect(result.toISOString()).toBe("2024-05-17T00:00:00.000Z");
  });

  it("leaves a midnight timestamp alone", () => {
    expect(startOfUtcDay(new Date("2024-05-17T00:00:00Z")).toISOString()).toBe(
      "2024-05-17T00:00:00.000Z",
    );
  });

  it("handles a month boundary", () => {
    expect(startOfUtcDay(new Date("2024-03-01T00:30:00Z")).toISOString()).toBe(
      "2024-03-01T00:00:00.000Z",
    );
  });
});

describe("dailyWindow", () => {
  const now = new Date("2024-05-17T13:00:00Z");

  it("treats a member who has never earned XP as fresh", () => {
    const window = dailyWindow(0, null, now);

    expect(window.xpToday).toBe(0);
    expect(window.needsReset).toBe(true);
    expect(window.resetAt.toISOString()).toBe("2024-05-18T00:00:00.000Z");
  });

  it("keeps today's total when already reset today", () => {
    const window = dailyWindow(120, new Date("2024-05-17T00:05:00Z"), now);

    expect(window.xpToday).toBe(120);
    expect(window.needsReset).toBe(false);
  });

  it("resets a stale counter from yesterday", () => {
    const window = dailyWindow(900, new Date("2024-05-16T10:00:00Z"), now);

    expect(window.xpToday).toBe(0);
    expect(window.needsReset).toBe(true);
  });

  it("resets a counter from the day before a month boundary", () => {
    const window = dailyWindow(500, new Date("2024-04-30T23:59:00Z"), now);

    expect(window.xpToday).toBe(0);
    expect(window.needsReset).toBe(true);
  });

  it("always points at the next UTC midnight", () => {
    const window = dailyWindow(10, new Date("2024-05-17T01:00:00Z"), now);

    expect(window.resetAt.toISOString()).toBe("2024-05-18T00:00:00.000Z");
  });

  it("does not reset a counter stamped later today", () => {
    // A reset timestamp in the future should not wipe today's total.
    const window = dailyWindow(400, new Date("2024-05-17T18:00:00Z"), now);

    expect(window.xpToday).toBe(400);
    expect(window.needsReset).toBe(false);
  });
});

describe("applyDailyCap", () => {
  it("passes the full amount through when under the cap", () => {
    expect(applyDailyCap(15, 0, 1000)).toBe(15);
    expect(applyDailyCap(15, 900, 1000)).toBe(15);
  });

  it("reduces the amount to what is left today", () => {
    expect(applyDailyCap(15, 995, 1000)).toBe(5);
  });

  it("returns nothing once the cap is reached", () => {
    expect(applyDailyCap(15, 1000, 1000)).toBe(0);
    expect(applyDailyCap(15, 1500, 1000)).toBe(0);
  });

  it("treats a cap of zero or less as no cap", () => {
    expect(applyDailyCap(15, 99999, 0)).toBe(15);
    expect(applyDailyCap(15, 99999, -1)).toBe(15);
  });

  it("never awards negative XP", () => {
    expect(applyDailyCap(-10, 0, 1000)).toBe(-10);
  });

  it("handles an exactly-full boundary", () => {
    expect(applyDailyCap(1, 999, 1000)).toBe(1);
  });
});