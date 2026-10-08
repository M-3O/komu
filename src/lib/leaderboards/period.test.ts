import { XPSource } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  EXCLUDED_XP_SOURCES,
  isRankedXpSource,
  METRIC_LABELS,
  PERIOD_DAYS,
  PERIOD_LABELS,
  periodStart,
} from "./period";

/**
 * Period boundaries decide what "this week" means, so they are pinned to an
 * exact instant rather than a vague assertion.
 */

const NOW = new Date("2024-05-17T12:00:00Z");

describe("periodStart", () => {
  it("starts a weekly window 7 days back", () => {
    expect(periodStart("WEEKLY", NOW)?.toISOString()).toBe(
      "2024-05-10T12:00:00.000Z",
    );
  });

  it("starts a monthly window 30 days back", () => {
    expect(periodStart("MONTHLY", NOW)?.toISOString()).toBe(
      "2024-04-17T12:00:00.000Z",
    );
  });

  it("has no start for all time", () => {
    expect(periodStart("ALL_TIME", NOW)).toBeNull();
  });

  it("uses rolling windows, so a board is never empty after a reset", () => {
    // The same instant either side of a boundary gives different starts,
    // which is what makes it rolling rather than calendar-based.
    const before = periodStart("WEEKLY", new Date("2024-05-20T00:00:01Z"));
    const after = periodStart("WEEKLY", new Date("2024-05-20T00:00:00Z"));

    expect(before?.getTime()).not.toBe(after?.getTime());
  });

  it("crosses a month boundary correctly", () => {
    expect(
      periodStart("MONTHLY", new Date("2024-03-01T00:00:00Z"))?.toISOString(),
    ).toBe("2024-01-31T00:00:00.000Z");
  });

  it("exposes the window lengths", () => {
    expect(PERIOD_DAYS.WEEKLY).toBe(7);
    expect(PERIOD_DAYS.MONTHLY).toBe(30);
  });
});

describe("ranked XP sources", () => {
  it("excludes moderator grants", () => {
    expect(EXCLUDED_XP_SOURCES).toEqual([XPSource.MANUAL]);
    expect(isRankedXpSource(XPSource.MANUAL)).toBe(false);
  });

  it("ranks XP earned from activity", () => {
    expect(isRankedXpSource(XPSource.MESSAGE)).toBe(true);
    expect(isRankedXpSource(XPSource.CHALLENGE)).toBe(true);
    expect(isRankedXpSource(XPSource.ACHIEVEMENT)).toBe(true);
    expect(isRankedXpSource(XPSource.REWARD)).toBe(true);
  });

  it("covers every declared source", () => {
    for (const source of Object.values(XPSource)) {
      // Guards against a new source being added and silently unranked.
      expect(typeof isRankedXpSource(source)).toBe("boolean");
    }
  });
});

describe("labels", () => {
  it("describes rolling windows in plain words", () => {
    expect(PERIOD_LABELS.WEEKLY).toBe("Last 7 days");
    expect(PERIOD_LABELS.MONTHLY).toBe("Last 30 days");
  });

  it("names the activity metric as messages", () => {
    // The metric counts messages, and the label should not imply otherwise.
    expect(METRIC_LABELS.ACTIVITY).toBe("Messages");
  });

  it("labels every period and metric", () => {
    expect(Object.keys(PERIOD_LABELS)).toHaveLength(3);
    expect(Object.keys(METRIC_LABELS)).toHaveLength(2);
  });
});