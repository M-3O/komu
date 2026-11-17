import { describe, expect, it } from "vitest";
import { checkInDeadline, MINUTE, schedulesOverlap } from "./lifecycle";
import { parseSeasonDate, seasonLocalDate } from "./schedule";

describe("season schedule", () => {
  it("round trips times without relying on the server time zone", () => {
    const time = parseSeasonDate("2027-06-04T21:30", "Asia/Riyadh");
    expect(time?.toISOString()).toBe("2027-06-04T18:30:00.000Z");
    expect(seasonLocalDate(time!, "Asia/Riyadh")).toBe("2027-06-04T21:30");
    expect(parseSeasonDate("2027-06-04T21:30", "Bad/Zone")).toBeNull();
  });

  it("rejects ambiguous DST folds, skipped times, and invalid dates", () => {
    expect(parseSeasonDate("2027-11-07T01:30", "America/New_York")).toBeNull();
    expect(parseSeasonDate("2027-03-14T02:30", "America/New_York")).toBeNull();
    expect(parseSeasonDate("2027-02-30T12:00", "UTC")).toBeNull();
  });

  it("checks overlapping inclusive windows per account", () => {
    const a = { accountId: "one", scheduledAt: new Date(0) };
    const b = { accountId: "one", scheduledAt: new Date(90 * MINUTE) };
    expect(schedulesOverlap(a, b)).toBe(true);
    expect(schedulesOverlap(a, { ...b, accountId: "two" })).toBe(false);
    expect(schedulesOverlap(a, { ...b, scheduledAt: new Date(90 * MINUTE + 1) })).toBe(false);
  });

  it("uses the earliest deadline even when a provider outage hides the end", () => {
    const opened = new Date(0);
    const ended = new Date(5 * MINUTE);
    expect(checkInDeadline(opened, ended, new Date(60 * MINUTE))).toBe(20 * MINUTE);
    expect(checkInDeadline(opened, null, new Date(60 * MINUTE))).toBe(60 * MINUTE);
    expect(checkInDeadline(opened, null, new Date(600 * MINUTE))).toBe(360 * MINUTE);
  });
});
