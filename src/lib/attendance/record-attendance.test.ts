import { describe, expect, it } from "vitest";

import { ATTENDANCE_XP } from "./record-attendance";

/**
 * Contract tests for the attendance service.
 *
 * The real deduplication happens in the database via
 * `createMany({ skipDuplicates: true })` against a unique constraint, which
 * a unit test cannot exercise. These lock in the parts that are pure, and
 * the integration check against the live database covers the rest.
 */

describe("attendance XP", () => {
  it("is a positive, round amount", () => {
    expect(ATTENDANCE_XP).toBeGreaterThan(0);
    expect(Number.isInteger(ATTENDANCE_XP)).toBe(true);
  });

  it("is comparable to a message award, but distinct from it", () => {
    // The default message award is 15 XP, attendance 25. If these ever become
    // equal it is probably a copy-paste mistake worth noticing.
    expect(ATTENDANCE_XP).not.toBe(15);
  });
});