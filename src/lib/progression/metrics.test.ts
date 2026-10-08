import { ProgressionMetric } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  daysSince,
  METRIC_LABELS,
  METRIC_UNITS,
  AVAILABLE_METRICS,
  UNAVAILABLE_METRICS,
  meetsThreshold,
  metricValue,
  type MemberStats,
} from "./metrics";

/**
 * The shared metric maths. Role rules and rewards both depend on these, so a
 * change here changes both.
 */

const NOW = new Date("2024-05-17T12:00:00Z");

function stats(overrides: Partial<MemberStats> = {}): MemberStats {
  return {
    xp: 0,
    level: 1,
    messageCount: 0,
    streamAttendanceCount: 0,
    watchTimeMinutes: 0,
    joinedAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("daysSince", () => {
  it("counts whole days", () => {
    expect(daysSince(new Date("2024-05-10T12:00:00Z"), NOW)).toBe(7);
  });

  it("does not count a partial day", () => {
    expect(daysSince(new Date("2024-05-16T13:00:00Z"), NOW)).toBe(0);
  });

  it("never returns a negative number", () => {
    expect(daysSince(new Date("2025-01-01T00:00:00Z"), NOW)).toBe(0);
  });
});

describe("metricValue", () => {
  const member = stats({
    xp: 5500,
    level: 10,
    messageCount: 420,
    streamAttendanceCount: 7,
    watchTimeMinutes: 150,
  });

  it("reads each metric from the right field", () => {
    expect(metricValue(ProgressionMetric.XP, member, NOW)).toBe(5500);
    expect(metricValue(ProgressionMetric.LEVEL, member, NOW)).toBe(10);
    expect(metricValue(ProgressionMetric.MESSAGE_COUNT, member, NOW)).toBe(420);
    expect(metricValue(ProgressionMetric.STREAM_ATTENDANCE, member, NOW)).toBe(7);
  });

  it("converts stored minutes into whole hours", () => {
    expect(metricValue(ProgressionMetric.WATCH_TIME_HOURS, member, NOW)).toBe(2);
  });

  it("rounds hours down, never up", () => {
    expect(
      metricValue(ProgressionMetric.WATCH_TIME_HOURS, stats({ watchTimeMinutes: 119 }), NOW),
    ).toBe(1);
  });

  it("covers every declared metric", () => {
    for (const metric of Object.values(ProgressionMetric)) {
      expect(typeof metricValue(metric, member, NOW)).toBe("number");
    }
  });
});

describe("meetsThreshold", () => {
  it("is true at the threshold", () => {
    expect(meetsThreshold(ProgressionMetric.LEVEL, 10, stats({ level: 10 }), NOW)).toBe(true);
  });

  it("is false one short", () => {
    expect(meetsThreshold(ProgressionMetric.LEVEL, 10, stats({ level: 9 }), NOW)).toBe(false);
  });

  it("treats zero as always satisfied", () => {
    expect(
      meetsThreshold(ProgressionMetric.MEMBER_AGE_DAYS, 0, stats(), NOW),
    ).toBe(true);
  });

  it("handles the 30 day membership example from the PRD", () => {
    const thirtyDays = ProgressionMetric.MEMBER_AGE_DAYS;

    expect(
      meetsThreshold(thirtyDays, 30, stats({ joinedAt: new Date("2024-05-01T00:00:00Z") }), NOW),
    ).toBe(false);
    expect(
      meetsThreshold(thirtyDays, 30, stats({ joinedAt: new Date("2024-04-01T00:00:00Z") }), NOW),
    ).toBe(true);
  });
});

describe("metric availability", () => {
  it("offers only metrics with a working data source", () => {
    expect(AVAILABLE_METRICS).toEqual([
      ProgressionMetric.LEVEL,
      ProgressionMetric.XP,
      ProgressionMetric.MESSAGE_COUNT,
      ProgressionMetric.STREAM_ATTENDANCE,
      ProgressionMetric.MEMBER_AGE_DAYS,
    ]);
  });

  it("excludes watch time and explains why", () => {
    expect(AVAILABLE_METRICS).not.toContain(ProgressionMetric.WATCH_TIME_HOURS);
    expect(UNAVAILABLE_METRICS[ProgressionMetric.WATCH_TIME_HOURS]).toMatch(
      /not collected/i,
    );
  });

  it("offers stream attendance now that it is captured", () => {
    // Attendance became real in the attendance-capture phase.
    expect(AVAILABLE_METRICS).toContain(ProgressionMetric.STREAM_ATTENDANCE);
    expect(UNAVAILABLE_METRICS[ProgressionMetric.STREAM_ATTENDANCE]).toBeUndefined();
  });

  it("never offers a metric it marks unavailable", () => {
    for (const metric of AVAILABLE_METRICS) {
      expect(UNAVAILABLE_METRICS[metric]).toBeUndefined();
    }
  });
});

describe("labels", () => {
  it("describes every metric", () => {
    for (const metric of Object.values(ProgressionMetric)) {
      expect(METRIC_LABELS[metric]).toBeTruthy();
      expect(METRIC_UNITS[metric]).toBeTruthy();
    }
  });

  it("names the attendance unit clearly", () => {
    expect(METRIC_UNITS.STREAM_ATTENDANCE).toBe("streams");
  });
});