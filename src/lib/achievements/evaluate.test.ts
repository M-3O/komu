import { AchievementType } from "@prisma/client";
import { describe, expect, it } from "vitest";

import type { MemberStats } from "@/lib/progression/metrics";
import {
  ACHIEVEMENT_TYPE_LABELS,
  ACHIEVEMENT_UNITS,
  AVAILABLE_ACHIEVEMENT_TYPES,
  achievementProgress,
  conditionMet,
  defaultThresholdFor,
  describeAchievement,
  evaluateUnlock,
  metricFor,
  partitionUnlocks,
  UNAVAILABLE_ACHIEVEMENT_TYPES,
  type AchievementInput,
} from "./evaluate";

/**
 * Achievement conditions (PRD section 7.10).
 *
 * An achievement is a lifetime milestone, so these read the member's totals
 * rather than any windowed progress.
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

function achievement(overrides: Partial<AchievementInput> = {}): AchievementInput {
  return {
    id: "ach-1",
    name: "Ten Streams",
    type: AchievementType.STREAM_ATTENDANCE_COUNT,
    threshold: 10,
    enabled: true,
    ...overrides,
  };
}

describe("metricFor", () => {
  it("maps First Stream onto the attendance counter", () => {
    // Attending one stream is an attendance count of one. Giving it its own
    // code path would mean two places to keep the same logic correct.
    expect(metricFor(AchievementType.FIRST_STREAM)).toBe("STREAM_ATTENDANCE");
  });

  it("maps each type to the metric it measures", () => {
    expect(metricFor(AchievementType.STREAM_ATTENDANCE_COUNT)).toBe("STREAM_ATTENDANCE");
    expect(metricFor(AchievementType.MESSAGE_COUNT)).toBe("MESSAGE_COUNT");
    expect(metricFor(AchievementType.LEVEL)).toBe("LEVEL");
    expect(metricFor(AchievementType.MEMBER_AGE_DAYS)).toBe("MEMBER_AGE_DAYS");
    expect(metricFor(AchievementType.WATCH_TIME_HOURS)).toBe("WATCH_TIME_HOURS");
  });
});

describe("achievementProgress", () => {
  it("reads the lifetime total for each type", () => {
    const member = stats({
      level: 25,
      messageCount: 1000,
      streamAttendanceCount: 10,
      watchTimeMinutes: 6000,
    });

    expect(
      achievementProgress(
        achievement({ type: AchievementType.STREAM_ATTENDANCE_COUNT }),
        member,
        NOW,
      ),
    ).toBe(10);
    expect(
      achievementProgress(achievement({ type: AchievementType.MESSAGE_COUNT }), member, NOW),
    ).toBe(1000);
    expect(achievementProgress(achievement({ type: AchievementType.LEVEL }), member, NOW)).toBe(25);
    expect(
      achievementProgress(
        achievement({ type: AchievementType.WATCH_TIME_HOURS, threshold: 100 }),
        member,
        NOW,
      ),
    ).toBe(100);
  });

  it("measures First Stream as an attendance count of at least one", () => {
    expect(
      achievementProgress(
        achievement({ type: AchievementType.FIRST_STREAM, threshold: 1 }),
        stats({ streamAttendanceCount: 0 }),
        NOW,
      ),
    ).toBe(0);
    expect(
      conditionMet(
        achievement({ type: AchievementType.FIRST_STREAM, threshold: 1 }),
        stats({ streamAttendanceCount: 1 }),
        NOW,
      ),
    ).toBe(true);
  });

  it("handles the OG Member example from the PRD", () => {
    const og = achievement({ type: AchievementType.MEMBER_AGE_DAYS, threshold: 365 });

    expect(conditionMet(og, stats({ joinedAt: new Date("2023-01-01T00:00:00Z") }), NOW)).toBe(
      true,
    );
    expect(conditionMet(og, stats({ joinedAt: new Date("2024-05-01T00:00:00Z") }), NOW)).toBe(
      false,
    );
  });

  it("is not met for watch time, because nothing collects it", () => {
    // Even a member with a huge stored watch time would qualify, but the
    // value is always zero in practice. The type is not offered.
    const none = achievement({
      type: AchievementType.WATCH_TIME_HOURS,
      threshold: 1,
    });

    expect(conditionMet(none, stats({ watchTimeMinutes: 0 }), NOW)).toBe(false);
  });
});

describe("evaluateUnlock", () => {
  it("unlocks an earned achievement", () => {
    const result = evaluateUnlock(
      achievement({ threshold: 5 }),
      stats({ streamAttendanceCount: 5 }),
      [],
      NOW,
    );

    expect(result).toEqual({ eligible: true });
  });

  it("does not unlock a disabled achievement even when earned", () => {
    const result = evaluateUnlock(
      achievement({ enabled: false }),
      stats({ streamAttendanceCount: 999 }),
      [],
      NOW,
    );

    expect(result).toEqual({ eligible: false, reason: "DISABLED" });
  });

  it("does not unlock the same achievement twice", () => {
    const result = evaluateUnlock(
      achievement(),
      stats({ streamAttendanceCount: 10 }),
      ["ach-1"],
      NOW,
    );

    expect(result).toEqual({ eligible: false, reason: "ALREADY_UNLOCKED" });
  });

  it("does not unlock an unearned achievement", () => {
    const result = evaluateUnlock(achievement(), stats({ streamAttendanceCount: 2 }), [], NOW);
    expect(result).toEqual({ eligible: false, reason: "NOT_MET" });
  });

  it("ignores another member's unlocks", () => {
    const result = evaluateUnlock(
      achievement(),
      stats({ streamAttendanceCount: 10 }),
      ["someone-elses-achievement"],
      NOW,
    );

    expect(result).toEqual({ eligible: true });
  });

  it("unlocks exactly once across repeated checks", () => {
    // Simulates every message a member sends after earning it.
    let unlocked = 0;
    const unlockedIds: string[] = [];

    for (let pass = 0; pass < 10; pass++) {
      const result = evaluateUnlock(
        achievement(),
        stats({ streamAttendanceCount: 10 }),
        unlockedIds,
        NOW,
      );

      if (result.eligible) {
        unlocked += 1;
        unlockedIds.push("ach-1");
      }
    }

    expect(unlocked).toBe(1);
  });
});

describe("partitionUnlocks", () => {
  it("splits a mixed set", () => {
    const list = [
      achievement({ id: "a", threshold: 5 }),
      achievement({ id: "b", threshold: 500 }),
      achievement({ id: "c", type: AchievementType.LEVEL, threshold: 5 }),
      achievement({ id: "d", threshold: 1, enabled: false }),
    ];

    const result = partitionUnlocks(
      list,
      stats({ streamAttendanceCount: 10, level: 10 }),
      ["c"],
      NOW,
    );

    expect(result.eligible.map((a) => a.id)).toEqual(["a"]);
    expect(result.skipped.map((s) => s.reason).sort()).toEqual(["ALREADY_UNLOCKED", "DISABLED", "NOT_MET"]);
  });

  it("returns nothing when there are no achievements", () => {
    const result = partitionUnlocks([], stats({ level: 999 }), [], NOW);

    expect(result.eligible).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });
});

describe("type availability", () => {
  it("offers the types with a working data source", () => {
    expect(AVAILABLE_ACHIEVEMENT_TYPES).toEqual([
      "STREAM_ATTENDANCE_COUNT",
      "MESSAGE_COUNT",
      "LEVEL",
      "MEMBER_AGE_DAYS",
    ]);
  });

  it("does not offer watch time, and explains why", () => {
    expect(AVAILABLE_ACHIEVEMENT_TYPES).not.toContain(AchievementType.WATCH_TIME_HOURS);
    expect(UNAVAILABLE_ACHIEVEMENT_TYPES.WATCH_TIME_HOURS).toMatch(/not collected/i);
  });

  it("does not offer First Stream as a separate type", () => {
    // It is a specific milestone, not a counter to tune. A creator who wants
    // it creates it with a threshold of 1.
    expect(AVAILABLE_ACHIEVEMENT_TYPES).not.toContain(AchievementType.FIRST_STREAM);
  });

  it("never offers a type it marks unavailable", () => {
    for (const type of AVAILABLE_ACHIEVEMENT_TYPES) {
      expect(UNAVAILABLE_ACHIEVEMENT_TYPES[type]).toBeUndefined();
    }
  });

  it("has a label and a unit for every declared type", () => {
    for (const type of Object.values(AchievementType)) {
      expect(ACHIEVEMENT_TYPE_LABELS[type]).toBeTruthy();
      expect(ACHIEVEMENT_UNITS[type]).toBeTruthy();
    }
  });
});

describe("defaultThresholdFor", () => {
  it("is one for First Stream", () => {
    expect(defaultThresholdFor(AchievementType.FIRST_STREAM)).toBe(1);
  });

  it("is something meaningful for the rest", () => {
    for (const type of AVAILABLE_ACHIEVEMENT_TYPES) {
      expect(defaultThresholdFor(type)).toBeGreaterThan(0);
    }
  });
});

describe("describeAchievement", () => {
  it("reads as a sentence", () => {
    expect(describeAchievement(achievement({ threshold: 10 }))).toBe("Ten Streams (10 streams)");
  });

  it("uses the unit of the achievement's own type", () => {
    expect(
      describeAchievement(achievement({ type: AchievementType.MEMBER_AGE_DAYS, threshold: 30 })),
    ).toBe("Ten Streams (30 days in server)");
  });
});