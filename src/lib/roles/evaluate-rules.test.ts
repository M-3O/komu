import { ProgressionMetric } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  daysSince,
  describeRule,
  evaluateRules,
  metricValue,
  ruleSatisfied,
  SUPPORTED_METRICS,
  UNAVAILABLE_METRICS,
  type MemberStats,
  type RoleRuleInput,
} from "./evaluate-rules";

/**
 * PRD section 7.6 requires that eligible members get the role, that the same
 * role is not added repeatedly, and that missing permissions are handled.
 * The last one is covered by the bot service; these cover the first two.
 */

const now = new Date("2024-05-17T12:00:00Z");

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

function rule(overrides: Partial<RoleRuleInput> = {}): RoleRuleInput {
  return {
    id: "rule-1",
    name: "Veteran",
    metric: ProgressionMetric.LEVEL,
    threshold: 20,
    roleId: "role-1",
    roleName: "Elite",
    ...overrides,
  };
}

describe("daysSince", () => {
  it("counts whole days", () => {
    expect(daysSince(new Date("2024-05-10T12:00:00Z"), now)).toBe(7);
  });

  it("does not count a partial day", () => {
    expect(daysSince(new Date("2024-05-16T13:00:00Z"), now)).toBe(0);
  });

  it("never returns a negative number", () => {
    // A member whose join date is somehow in the future.
    expect(daysSince(new Date("2025-01-01T00:00:00Z"), now)).toBe(0);
  });
});

describe("metricValue", () => {
  it("reads each metric from the right field", () => {
    const member = stats({
      xp: 5500,
      level: 10,
      messageCount: 420,
      streamAttendanceCount: 7,
      watchTimeMinutes: 150,
    });

    expect(metricValue(ProgressionMetric.XP, member, now)).toBe(5500);
    expect(metricValue(ProgressionMetric.LEVEL, member, now)).toBe(10);
    expect(metricValue(ProgressionMetric.MESSAGE_COUNT, member, now)).toBe(420);
    expect(metricValue(ProgressionMetric.STREAM_ATTENDANCE, member, now)).toBe(7);
  });

  it("converts stored minutes into whole hours", () => {
    const member = stats({ watchTimeMinutes: 150 });

    expect(metricValue(ProgressionMetric.WATCH_TIME_HOURS, member, now)).toBe(2);
  });

  it("rounds hours down, never up", () => {
    const member = stats({ watchTimeMinutes: 119 });

    expect(metricValue(ProgressionMetric.WATCH_TIME_HOURS, member, now)).toBe(1);
  });
});

describe("ruleSatisfied", () => {
  it("is true when the value reaches the threshold", () => {
    expect(ruleSatisfied(rule({ threshold: 10 }), stats({ level: 10 }), now)).toBe(true);
  });

  it("is false one short of the threshold", () => {
    expect(ruleSatisfied(rule({ threshold: 10 }), stats({ level: 9 }), now)).toBe(false);
  });

  it("is true when the value exceeds the threshold", () => {
    expect(ruleSatisfied(rule({ threshold: 5 }), stats({ level: 50 }), now)).toBe(true);
  });

  it("treats a threshold of zero as always satisfied", () => {
    expect(
      ruleSatisfied(
        rule({ metric: ProgressionMetric.MEMBER_AGE_DAYS, threshold: 0 }),
        stats(),
        now,
      ),
    ).toBe(true);
  });

  it("handles the membership age example from the PRD", () => {
    const thirtyDays = rule({
      metric: ProgressionMetric.MEMBER_AGE_DAYS,
      threshold: 30,
    });
    const member = stats({ joinedAt: new Date("2024-05-01T00:00:00Z") });

    expect(ruleSatisfied(thirtyDays, member, now)).toBe(false);
    expect(
      ruleSatisfied(
        thirtyDays,
        stats({ joinedAt: new Date("2024-04-01T00:00:00Z") }),
        now,
      ),
    ).toBe(true);
  });
});

describe("evaluateRules", () => {
  it("assigns a rule the member qualifies for", () => {
    const result = evaluateRules(
      [rule({ threshold: 10 })],
      stats({ level: 20 }),
      [],
      now,
    );

    expect(result.toAssign).toHaveLength(1);
    expect(result.toAssign[0].roleName).toBe("Elite");
  });

  it("does not assign a rule the member does not qualify for", () => {
    const result = evaluateRules([rule({ threshold: 20 })], stats({ level: 19 }), [], now);

    expect(result.toAssign).toHaveLength(0);
    expect(result.unsatisfied).toHaveLength(1);
  });

  it("does not re-add a role the member already holds", () => {
    // The same rule, with the member already holding the role.
    const result = evaluateRules([rule()], stats({ level: 50 }), ["role-1"], now);

    expect(result.toAssign).toHaveLength(0);
    expect(result.alreadyHeld).toHaveLength(1);
  });

  it("assigns again once the member loses the role", () => {
    // Held roles are the live Discord list, so a removed role comes back.
    const result = evaluateRules([rule()], stats({ level: 50 }), [], now);

    expect(result.toAssign).toHaveLength(1);
  });

  it("splits a mixed set of rules correctly", () => {
    const rules = [
      rule({ id: "a", roleId: "role-a", threshold: 5, metric: ProgressionMetric.LEVEL }),
      rule({ id: "b", roleId: "role-b", threshold: 50, metric: ProgressionMetric.LEVEL }),
      rule({ id: "c", roleId: "role-c", threshold: 10, metric: ProgressionMetric.MESSAGE_COUNT }),
    ];

    const result = evaluateRules(
      rules,
      stats({ level: 20, messageCount: 500 }),
      ["role-c"],
      now,
    );

    expect(result.toAssign.map((r) => r.id)).toEqual(["a"]);
    expect(result.alreadyHeld.map((r) => r.id)).toEqual(["c"]);
    expect(result.unsatisfied.map((r) => r.id)).toEqual(["b"]);
  });

  it("returns nothing to do for an empty rule list", () => {
    const result = evaluateRules([], stats({ level: 999 }), [], now);

    expect(result.toAssign).toHaveLength(0);
    expect(result.alreadyHeld).toHaveLength(0);
    expect(result.unsatisfied).toHaveLength(0);
  });

  it("does not assign when the member holds nothing and qualifies for nothing", () => {
    const result = evaluateRules(
      [rule({ threshold: 100 })],
      stats({ level: 1 }),
      [],
      now,
    );

    expect(result.toAssign).toHaveLength(0);
  });
});

describe("metric availability", () => {
  it("offers only metrics with a working data source", () => {
    expect(SUPPORTED_METRICS).toEqual([
      ProgressionMetric.LEVEL,
      ProgressionMetric.XP,
      ProgressionMetric.MESSAGE_COUNT,
      ProgressionMetric.MEMBER_AGE_DAYS,
    ]);
  });

  it("explains why watch time and attendance are unavailable", () => {
    // The plan says to add a watch-time rule only when the data exists.
    expect(UNAVAILABLE_METRICS[ProgressionMetric.WATCH_TIME_HOURS]).toBeDefined();
    expect(
      UNAVAILABLE_METRICS[ProgressionMetric.STREAM_ATTENDANCE],
    ).toBeDefined();
  });

  it("does not offer a metric it cannot support", () => {
    for (const metric of SUPPORTED_METRICS) {
      expect(UNAVAILABLE_METRICS[metric]).toBeUndefined();
    }
  });
});

describe("describeRule", () => {
  it("reads as a sentence", () => {
    expect(describeRule(rule())).toBe("Veteran (20 level -> @Elite)");
  });

  it("names the unit for each metric", () => {
    expect(
      describeRule(rule({ metric: ProgressionMetric.WATCH_TIME_HOURS })),
    ).toContain("hours watched");
  });
});