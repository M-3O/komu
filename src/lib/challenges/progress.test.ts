import { describe, expect, it } from "vitest";

import {
  AVAILABLE_REQUIREMENT_TYPES,
  completionPercent,
  countersFrom,
  isComplete,
  parseStoredProgress,
  REQUIREMENT_LABELS,
  REQUIREMENT_UNITS,
  requirementLabel,
  requirementMet,
  requirementProgress,
  requirementStatuses,
  UNAVAILABLE_REQUIREMENT_TYPES,
  type ChallengeCounters,
  type ChallengeRequirementInput,
} from "./progress";

/**
 * Challenge progress (PRD section 7.9).
 *
 * The completion rule decides when a member gets XP and a role, so it is
 * checked here rather than only in the database.
 */

function requirement(
  overrides: Partial<ChallengeRequirementInput> = {},
): ChallengeRequirementInput {
  return {
    id: "req-1",
    type: "MESSAGE_COUNT",
    threshold: 20,
    label: null,
    ...overrides,
  };
}

function counters(overrides: Partial<ChallengeCounters> = {}): ChallengeCounters {
  return { messages: 0, attendance: 0, level: 1, ...overrides };
}

describe("countersFrom", () => {
  it("reads stored progress", () => {
    const result = countersFrom({ messages: 5, attendance: 2 }, 4);
    expect(result).toEqual({ messages: 5, attendance: 2, level: 4 });
  });

  it("treats missing progress as zero", () => {
    expect(countersFrom(null, 3)).toEqual({ messages: 0, attendance: 0, level: 3 });
    expect(countersFrom({}, 3)).toEqual({ messages: 0, attendance: 0, level: 3 });
  });
});

describe("parseStoredProgress", () => {
  it("reads a well-formed blob", () => {
    expect(parseStoredProgress({ messages: 5, attendance: 2 })).toEqual({
      messages: 5,
      attendance: 2,
    });
  });

  it("ignores anything that is not a number", () => {
    // The column is Prisma Json, so this is possible. A string count must not
    // turn into NaN and read as progress.
    expect(parseStoredProgress({ messages: "5", attendance: null })).toEqual({});
  });

  it("ignores negative and infinite counts", () => {
    expect(parseStoredProgress({ messages: -3 })).toEqual({});
    expect(parseStoredProgress({ attendance: Number.POSITIVE_INFINITY })).toEqual({});
    expect(parseStoredProgress({ messages: Number.NaN })).toEqual({});
  });

  it("rounds a fractional count down", () => {
    expect(parseStoredProgress({ messages: 4.7 })).toEqual({ messages: 4 });
  });

  it("returns empty for non-objects", () => {
    expect(parseStoredProgress(null)).toEqual({});
    expect(parseStoredProgress(undefined)).toEqual({});
    expect(parseStoredProgress("nonsense")).toEqual({});
    expect(parseStoredProgress(42)).toEqual({});
    expect(parseStoredProgress([1, 2, 3])).toEqual({});
  });

  it("ignores keys it does not know", () => {
    expect(parseStoredProgress({ messages: 3, somethingElse: 9 })).toEqual({ messages: 3 });
  });
});

describe("requirementProgress", () => {
  it("reads each type from the right counter", () => {
    const member = counters({ messages: 20, attendance: 3, level: 7 });

    expect(requirementProgress(requirement({ type: "MESSAGE_COUNT" }), member)).toBe(20);
    expect(requirementProgress(requirement({ type: "STREAM_ATTENDANCE" }), member)).toBe(3);
    expect(requirementProgress(requirement({ type: "LEVEL" }), member)).toBe(7);
  });

  it("reads zero for watch time, which is never collected", () => {
    const member = counters({ messages: 999, attendance: 999, level: 99 });
    expect(
      requirementProgress(requirement({ type: "WATCH_TIME_HOURS", threshold: 1 }), member),
    ).toBe(0);
  });
});

describe("requirementMet", () => {
  it("is true at the threshold", () => {
    expect(requirementMet(requirement({ threshold: 20 }), counters({ messages: 20 }))).toBe(true);
  });

  it("is false one short", () => {
    expect(requirementMet(requirement({ threshold: 20 }), counters({ messages: 19 }))).toBe(false);
  });

  it("is true past the threshold", () => {
    expect(requirementMet(requirement({ threshold: 5 }), counters({ messages: 40 }))).toBe(true);
  });

  it("is true for a zero threshold", () => {
    expect(requirementMet(requirement({ threshold: 0 }), counters())).toBe(true);
  });
});

describe("isComplete", () => {
  it("needs every requirement met", () => {
    const requirements = [
      requirement({ id: "a", type: "STREAM_ATTENDANCE", threshold: 3 }),
      requirement({ id: "b", type: "MESSAGE_COUNT", threshold: 20 }),
    ];

    expect(isComplete(requirements, counters({ attendance: 3, messages: 20 }))).toBe(true);
    expect(isComplete(requirements, counters({ attendance: 3, messages: 19 }))).toBe(false);
    expect(isComplete(requirements, counters({ attendance: 2, messages: 20 }))).toBe(false);
  });

  it("is false with no requirements", () => {
    // Otherwise creating an empty challenge would hand out its reward for
    // nothing.
    expect(isComplete([], counters({ messages: 999 }))).toBe(false);
  });

  it("handles the plan's combined example", () => {
    const requirements = [
      requirement({ id: "a", type: "STREAM_ATTENDANCE", threshold: 3 }),
      requirement({ id: "b", type: "MESSAGE_COUNT", threshold: 20 }),
      requirement({ id: "c", type: "LEVEL", threshold: 5 }),
    ];

    expect(
      isComplete(requirements, counters({ attendance: 3, messages: 20, level: 5 })),
    ).toBe(true);
    expect(
      isComplete(requirements, counters({ attendance: 3, messages: 20, level: 4 })),
    ).toBe(false);
  });
});

describe("completionPercent", () => {
  it("is 100 when complete", () => {
    const requirements = [
      requirement({ id: "a", threshold: 10 }),
      requirement({ id: "b", threshold: 10 }),
    ];

    expect(completionPercent(requirements, counters({ messages: 10 }))).toBe(100);
  });

  it("is 0 with no requirements", () => {
    expect(completionPercent([], counters({ messages: 500 }))).toBe(0);
  });

  it("weights each requirement equally", () => {
    // One requirement done, one untouched. Weighted by threshold size instead,
    // the first would dominate; each requirement is worth a half.
    const requirements = [
      requirement({ id: "a", type: "MESSAGE_COUNT", threshold: 10 }),
      requirement({ id: "b", type: "STREAM_ATTENDANCE", threshold: 10 }),
    ];

    expect(completionPercent(requirements, counters({ messages: 10, attendance: 0 }))).toBe(50);
  });

  it("does not exceed 100 when a member overshoots", () => {
    const requirements = [requirement({ threshold: 5 })];
    expect(completionPercent(requirements, counters({ messages: 500 }))).toBe(100);
  });

  it("rounds to a whole percent", () => {
    const requirements = [requirement({ threshold: 3 })];
    const value = completionPercent(requirements, counters({ messages: 1 }));
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBe(33);
  });
});

describe("requirementStatuses", () => {
  it("reports each requirement separately", () => {
    const statuses = requirementStatuses(
      [
        requirement({ id: "a", type: "STREAM_ATTENDANCE", threshold: 3 }),
        requirement({ id: "b", type: "MESSAGE_COUNT", threshold: 20 }),
      ],
      counters({ attendance: 2, messages: 25 }),
    );

    expect(statuses).toHaveLength(2);
    expect(statuses[0]).toMatchObject({ current: 2, threshold: 3, met: false });
    expect(statuses[1]).toMatchObject({ current: 25, threshold: 20, met: true });
  });
});

describe("requirementLabel", () => {
  it("defaults to the type's wording", () => {
    expect(requirementLabel(requirement({ type: "MESSAGE_COUNT", threshold: 20 }))).toBe(
      "Send 20 messages",
    );
  });

  it("uses singular for a threshold of one", () => {
    expect(requirementLabel(requirement({ type: "MESSAGE_COUNT", threshold: 1 }))).toBe(
      "Send 1 message",
    );
    expect(requirementLabel(requirement({ type: "STREAM_ATTENDANCE", threshold: 1 }))).toBe(
      "Attend 1 stream",
    );
  });

  it("prefers the creator's own wording", () => {
    expect(
      requirementLabel(requirement({ label: "Chat in #general", threshold: 20 })),
    ).toBe("Chat in #general");
  });

  it("falls back when the creator's wording is blank", () => {
    expect(requirementLabel(requirement({ label: "   ", threshold: 5 }))).toBe(
      "Send 5 messages",
    );
  });
});

describe("requirement availability", () => {
  it("offers attendance, messages and level", () => {
    expect(AVAILABLE_REQUIREMENT_TYPES).toEqual([
      "STREAM_ATTENDANCE",
      "MESSAGE_COUNT",
      "LEVEL",
    ]);
  });

  it("does not offer watch time and explains why", () => {
    expect(AVAILABLE_REQUIREMENT_TYPES).not.toContain("WATCH_TIME_HOURS");
    expect(UNAVAILABLE_REQUIREMENT_TYPES.WATCH_TIME_HOURS).toMatch(/not collected/i);
  });

  it("never offers a type it marks unavailable", () => {
    for (const type of AVAILABLE_REQUIREMENT_TYPES) {
      expect(UNAVAILABLE_REQUIREMENT_TYPES[type]).toBeUndefined();
    }
  });

  it("has a label and a unit for every declared type", () => {
    for (const type of [
      "MESSAGE_COUNT",
      "STREAM_ATTENDANCE",
      "WATCH_TIME_HOURS",
      "LEVEL",
    ] as const) {
      expect(REQUIREMENT_LABELS[type](1)).toBeTruthy();
      expect(REQUIREMENT_UNITS[type]).toBeTruthy();
    }
  });
});