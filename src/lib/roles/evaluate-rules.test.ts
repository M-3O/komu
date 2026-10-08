import { ProgressionMetric } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  describeRule,
  evaluateRules,
  ruleSatisfied,
  SUPPORTED_METRICS,
  UNAVAILABLE_METRICS,
  type MemberStats,
  type RoleRuleInput,
} from "./evaluate-rules";

/**
 * PRD section 7.6 requires that eligible members get the role, that the same
 * role is not added repeatedly, and that missing permissions are handled.
 * The last is covered by the bot service; metric maths is covered in
 * lib/progression/metrics.test.ts; these cover role assignment.
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

describe("ruleSatisfied", () => {
  it("is true when the value reaches the threshold", () => {
    expect(ruleSatisfied(rule({ threshold: 10 }), stats({ level: 10 }), now)).toBe(true);
  });

  it("is false one short of the threshold", () => {
    expect(ruleSatisfied(rule({ threshold: 10 }), stats({ level: 9 }), now)).toBe(false);
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

  it("stays stable across repeated checks", () => {
    for (let pass = 0; pass < 5; pass++) {
      expect(evaluateRules([rule()], stats({ level: 50 }), ["role-1"], now).toAssign)
        .toHaveLength(0);
    }
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

  it("now supports a stream attendance rule", () => {
    // Attendance became real once reaction capture landed.
    const attendanceRule = rule({
      metric: ProgressionMetric.STREAM_ATTENDANCE,
      threshold: 3,
    });

    expect(
      evaluateRules([attendanceRule], stats({ streamAttendanceCount: 3 }), [], now)
        .toAssign,
    ).toHaveLength(1);
    expect(
      evaluateRules([attendanceRule], stats({ streamAttendanceCount: 2 }), [], now)
        .toAssign,
    ).toHaveLength(0);
  });
});

describe("metric availability", () => {
  it("still excludes watch time", () => {
    expect(SUPPORTED_METRICS).not.toContain(ProgressionMetric.WATCH_TIME_HOURS);
    expect(UNAVAILABLE_METRICS[ProgressionMetric.WATCH_TIME_HOURS]).toBeDefined();
  });

  it("includes stream attendance now that it is captured", () => {
    expect(SUPPORTED_METRICS).toContain(ProgressionMetric.STREAM_ATTENDANCE);
  });
});

describe("describeRule", () => {
  it("reads as a sentence", () => {
    expect(describeRule(rule())).toBe("Veteran (20 level -> @Elite)");
  });

  it("names the unit for each metric", () => {
    expect(describeRule(rule({ metric: ProgressionMetric.WATCH_TIME_HOURS }))).toContain(
      "hours watched",
    );
  });
});