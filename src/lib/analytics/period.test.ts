import { describe, expect, it } from "vitest";

import {
  bucketEvents,
  countDistinctByDay,
  dayKey,
  DEFAULT_RANGE,
  emptyBuckets,
  isAnalyticsRange,
  MAX_RANGE_DAYS,
  peakOf,
  rangeStart,
  RANGE_DAYS,
} from "./period";

/**
 * Analytics bucketing (PRD section 7.12).
 *
 * A chart that skips empty days draws a straight line across a quiet weekend,
 * which reads as steady activity rather than two silent days. That is the
 * behaviour most worth locking down here.
 */

const NOW = new Date("2024-05-17T12:00:00Z");

describe("isAnalyticsRange", () => {
  it("accepts the offered ranges", () => {
    expect(isAnalyticsRange("7D")).toBe(true);
    expect(isAnalyticsRange("30D")).toBe(true);
    expect(isAnalyticsRange("90D")).toBe(true);
  });

  it("rejects anything else, including undefined", () => {
    expect(isAnalyticsRange("1Y")).toBe(false);
    expect(isAnalyticsRange("30")).toBe(false);
    expect(isAnalyticsRange(undefined)).toBe(false);
    expect(isAnalyticsRange("")).toBe(false);
  });
});

describe("rangeStart", () => {
  it("covers exactly the number of days it names, including today", () => {
    // A window ending at midday spans one more calendar date than its name
    // suggests, so the range is snapped to whole days.
    expect(emptyBuckets(rangeStart("7D", NOW), NOW)).toHaveLength(7);
    expect(emptyBuckets(rangeStart("30D", NOW), NOW)).toHaveLength(30);
    expect(emptyBuckets(rangeStart("90D", NOW), NOW)).toHaveLength(90);
  });

  it("starts at UTC midnight", () => {
    const start = rangeStart("7D", NOW);
    expect(start.toISOString()).toBe("2024-05-11T00:00:00.000Z");
  });

  it("ends on today", () => {
    expect(rangeStart("7D", NOW).getTime()).toBeLessThan(NOW.getTime());
    expect(emptyBuckets(rangeStart("7D", NOW), NOW).at(-1)?.day).toBe("2024-05-17");
  });

  it("works for a now that is exactly midnight", () => {
    const midnight = new Date("2024-05-17T00:00:00Z");
    expect(emptyBuckets(rangeStart("7D", midnight), midnight)).toHaveLength(7);
  });

  it("has a range length for every offered option", () => {
    for (const range of Object.keys(RANGE_DAYS) as Array<keyof typeof RANGE_DAYS>) {
      expect(RANGE_DAYS[range]).toBeGreaterThan(0);
    }
  });
});

describe("dayKey", () => {
  it("is the UTC date", () => {
    expect(dayKey(new Date("2024-05-17T12:00:00Z"))).toBe("2024-05-17");
  });

  it("does not drift with the local timezone", () => {
    // 23:30 UTC is the next day in Tokyo and the previous evening in New York.
    // Bucketing by local time would put this event in different buckets on
    // different machines.
    expect(dayKey(new Date("2024-05-17T23:30:00Z"))).toBe("2024-05-17");
  });

  it("keeps times either side of midnight UTC apart", () => {
    expect(dayKey(new Date("2024-05-17T00:00:00Z"))).toBe("2024-05-17");
    expect(dayKey(new Date("2024-05-17T23:59:59Z"))).toBe("2024-05-17");
    expect(dayKey(new Date("2024-05-18T00:00:00Z"))).toBe("2024-05-18");
  });
});

describe("emptyBuckets", () => {
  it("fills the range with zeroed days", () => {
    const buckets = emptyBuckets(rangeStart("7D", NOW), NOW);
    expect(buckets).toHaveLength(7);
    expect(buckets.every((bucket) => bucket.messages === 0)).toBe(true);
  });

  it("starts on a whole day, even from a partial start", () => {
    const buckets = emptyBuckets(new Date("2024-05-10T17:30:00Z"), NOW);
    expect(buckets[0].day).toBe("2024-05-10");
  });

  it("counts consecutive days", () => {
    // The 7-day range includes today, so it runs 05-11 to 05-17.
    const buckets = emptyBuckets(rangeStart("7D", NOW), NOW);
    expect(buckets.map((bucket) => bucket.day)).toEqual([
      "2024-05-11",
      "2024-05-12",
      "2024-05-13",
      "2024-05-14",
      "2024-05-15",
      "2024-05-16",
      "2024-05-17",
    ]);
  });

  it("crosses a month boundary correctly", () => {
    const buckets = emptyBuckets(
      new Date("2024-05-30T00:00:00Z"),
      new Date("2024-06-02T00:00:00Z"),
    );

    // Both endpoints are included, since a range always covers today.
    expect(buckets.map((bucket) => bucket.day)).toEqual([
      "2024-05-30",
      "2024-05-31",
      "2024-06-01",
      "2024-06-02",
    ]);
  });

  it("falls back to a usable range rather than producing no bars", () => {
    // An Invalid Date here would yield an empty chart, which reads as "no
    // activity" rather than "bad input".
    const buckets = emptyBuckets(
      rangeStart("nonsense" as never, NOW),
      NOW,
    );

    expect(buckets.length).toBe(RANGE_DAYS[DEFAULT_RANGE]);
    expect(buckets.every((bucket) => bucket.day !== "NaN")).toBe(true);
  });

  it("caps the number of buckets", () => {
    // A range longer than the cap must not produce an unbounded array.
    const long = new Date(NOW.getTime() - 400 * 86_400_000);
    expect(emptyBuckets(long, NOW).length).toBeLessThanOrEqual(MAX_RANGE_DAYS);
  });

  it("respects an explicit smaller cap", () => {
    expect(emptyBuckets(rangeStart("30D", NOW), NOW, 5)).toHaveLength(5);
  });

});

describe("bucketEvents", () => {
  it("puts an event in the right day", () => {
    const buckets = emptyBuckets(new Date("2024-05-15T00:00:00Z"), NOW);

    bucketEvents(buckets, [{ createdAt: new Date("2024-05-16T09:00:00Z") }], (bucket) => {
      bucket.messages += 1;
    });

    expect(buckets.map((bucket) => bucket.messages)).toEqual([0, 1, 0]);
  });

  it("adds up several events in one day", () => {
    const buckets = emptyBuckets(new Date("2024-05-15T00:00:00Z"), NOW);

    bucketEvents(
      buckets,
      [
        { createdAt: new Date("2024-05-15T01:00:00Z") },
        { createdAt: new Date("2024-05-15T23:00:00Z") },
      ],
      (bucket) => {
        bucket.messages += 1;
      },
    );

    expect(buckets[0].messages).toBe(2);
  });

  it("ignores an event outside the range", () => {
    const buckets = emptyBuckets(new Date("2024-05-15T00:00:00Z"), NOW);

    bucketEvents(buckets, [{ createdAt: new Date("2024-05-01T09:00:00Z") }], (bucket) => {
      bucket.messages += 1;
    });

    expect(buckets.some((bucket) => bucket.messages > 0)).toBe(false);
  });

  it("leaves quiet days at zero rather than omitting them", () => {
    const buckets = emptyBuckets(new Date("2024-05-15T00:00:00Z"), NOW);

    bucketEvents(buckets, [{ createdAt: new Date("2024-05-17T09:00:00Z") }], (bucket) => {
      bucket.messages += 1;
    });

    // The quiet middle day is present and zero, so the chart shows a gap
    // instead of a straight line through it.
    expect(buckets).toHaveLength(3);
    expect(buckets[1].messages).toBe(0);
  });
});

describe("countDistinctByDay", () => {
  it("counts people, not messages", () => {
    const buckets = emptyBuckets(new Date("2024-05-15T00:00:00Z"), NOW);

    countDistinctByDay(buckets, [
      { createdAt: new Date("2024-05-15T01:00:00Z"), memberId: "a" },
      { createdAt: new Date("2024-05-15T02:00:00Z"), memberId: "a" },
      { createdAt: new Date("2024-05-15T03:00:00Z"), memberId: "b" },
    ]);

    // Three messages, two people.
    expect(buckets[0].activeMembers).toBe(2);
  });

  it("counts the same member separately on different days", () => {
    const buckets = emptyBuckets(new Date("2024-05-15T00:00:00Z"), NOW);

    countDistinctByDay(buckets, [
      { createdAt: new Date("2024-05-15T01:00:00Z"), memberId: "a" },
      { createdAt: new Date("2024-05-16T01:00:00Z"), memberId: "a" },
    ]);

    expect(buckets[0].activeMembers).toBe(1);
    expect(buckets[1].activeMembers).toBe(1);
  });

  it("leaves a quiet day at zero", () => {
    const buckets = emptyBuckets(new Date("2024-05-15T00:00:00Z"), NOW);

    countDistinctByDay(buckets, [
      { createdAt: new Date("2024-05-15T01:00:00Z"), memberId: "a" },
    ]);

    expect(buckets[1].activeMembers).toBe(0);
  });
});

describe("peakOf", () => {
  it("finds the largest value in a series", () => {
    const buckets = emptyBuckets(new Date("2024-05-15T00:00:00Z"), NOW);
    buckets[0].messages = 4;
    buckets[1].messages = 12;
    buckets[2].messages = 2;

    expect(peakOf(buckets, "messages")).toBe(12);
  });

  it("is zero for a flat series", () => {
    const buckets = emptyBuckets(new Date("2024-05-15T00:00:00Z"), NOW);
    expect(peakOf(buckets, "messages")).toBe(0);
  });

  it("is zero for an empty series", () => {
    expect(peakOf([], "messages")).toBe(0);
  });
});