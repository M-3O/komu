import { describe, expect, it } from "vitest";

import {
  capIsTheBindingLimit,
  cooldownMinutes,
  isValidSettings,
  LIMITS,
  messagesPerDay,
  validateSettings,
  type XpSettingsInput,
} from "./settings";

/** The settings every valid case starts from: the schema defaults. */
function settings(overrides: Partial<XpSettingsInput> = {}): XpSettingsInput {
  return {
    xpEnabled: true,
    xpMessageAmount: 15,
    xpMessageMinLength: 3,
    xpMessageCooldownSecs: 60,
    xpDailyCap: 1000,
    ...overrides,
  };
}

describe("validateSettings", () => {
  it("accepts the schema defaults", () => {
    expect(validateSettings(settings())).toEqual([]);
    expect(isValidSettings(settings())).toBe(true);
  });

  it("rejects zero XP per message", () => {
    // Zero would mean messages silently earn nothing.
    const result = validateSettings(settings({ xpMessageAmount: 0 }));
    expect(result.map((problem) => problem.field)).toContain("xpMessageAmount");
  });

  it("rejects a negative XP amount", () => {
    expect(isValidSettings(settings({ xpMessageAmount: -5 }))).toBe(false);
  });

  it("rejects a fractional XP amount", () => {
    // XP is an integer column, so a fractional value would be rounded silently.
    expect(isValidSettings(settings({ xpMessageAmount: 15.5 }))).toBe(false);
  });

  it("rejects a minimum length below one", () => {
    expect(isValidSettings(settings({ xpMessageMinLength: 0 }))).toBe(false);
  });

  it("allows a zero cooldown, which disables it", () => {
    expect(isValidSettings(settings({ xpMessageCooldownSecs: 0 }))).toBe(true);
  });

  it("rejects a negative cooldown", () => {
    expect(isValidSettings(settings({ xpMessageCooldownSecs: -1 }))).toBe(false);
  });

  it("rejects a cooldown longer than a day", () => {
    expect(isValidSettings(settings({ xpMessageCooldownSecs: 86_401 }))).toBe(false);
  });

  it("allows a zero daily cap, which means no limit", () => {
    expect(isValidSettings(settings({ xpDailyCap: 0 }))).toBe(true);
  });

  it("rejects a negative daily cap", () => {
    expect(isValidSettings(settings({ xpDailyCap: -1 }))).toBe(false);
  });

  it("rejects values past the limits", () => {
    expect(isValidSettings(settings({ xpMessageAmount: LIMITS.xpMessageAmount + 1 }))).toBe(false);
    expect(isValidSettings(settings({ xpDailyCap: LIMITS.xpDailyCap + 1 }))).toBe(false);
  });

  it("reports every problem at once", () => {
    // Making a creator resubmit to find the second problem is needless.
    const problems = validateSettings(
      settings({ xpMessageAmount: 0, xpMessageCooldownSecs: -1, xpDailyCap: -5 }),
    );

    expect(problems.map((problem) => problem.field).sort()).toEqual([
      "xpDailyCap",
      "xpMessageAmount",
      "xpMessageCooldownSecs",
    ]);
  });

  it("gives every problem a message worth showing", () => {
    for (const problem of validateSettings(settings({ xpMessageAmount: 0 }))) {
      expect(problem.message.length).toBeGreaterThan(0);
    }
  });

  it("allows XP to be switched off entirely", () => {
    expect(isValidSettings(settings({ xpEnabled: false }))).toBe(true);
  });
});

describe("messagesPerDay", () => {
  it("is bounded by the cooldown when the cap is generous", () => {
    // 86400 / 60 = 1440 messages, but the 1000 XP cap at 15 XP allows only 66.
    expect(messagesPerDay(settings())).toBe(66);
  });

  it("is bounded by the cooldown when there is no cap", () => {
    expect(messagesPerDay(settings({ xpDailyCap: 0 }))).toBe(1440);
  });

  it("is bounded by the cap when the cooldown is short", () => {
    // No cooldown, so only the cap binds: 1000 / 20 = 50.
    expect(messagesPerDay(settings({ xpMessageCooldownSecs: 0, xpMessageAmount: 20 }))).toBe(50);
  });

  it("is zero when the cap is smaller than one message", () => {
    expect(messagesPerDay(settings({ xpDailyCap: 5, xpMessageAmount: 15 }))).toBe(0);
  });

  it("is zero when both limits are off", () => {
    // No cooldown and no cap: the number is unbounded, which is reported as 0
    // rather than Infinity, so the dashboard does not print "Infinity".
    expect(messagesPerDay(settings({ xpDailyCap: 0, xpMessageCooldownSecs: 0 }))).toBe(0);
  });

  it("never returns a fraction", () => {
    // 10 XP, 7 XP cap.
    expect(Number.isInteger(messagesPerDay(settings({ xpMessageAmount: 7, xpDailyCap: 10 })))).toBe(
      true,
    );
  });
});

describe("capIsTheBindingLimit", () => {
  it("is true when the cap is the tighter of the two", () => {
    expect(capIsTheBindingLimit(settings())).toBe(true);
  });

  it("is false when the cooldown is tighter", () => {
    // 60 second cooldown allows 1440; a 100,000 cap at 15 XP allows 6,666.
    expect(capIsTheBindingLimit(settings({ xpDailyCap: 100_000 }))).toBe(false);
  });

  it("is false when there is no cap", () => {
    expect(capIsTheBindingLimit(settings({ xpDailyCap: 0 }))).toBe(false);
  });

  it("is false when the cap and cooldown bind equally", () => {
    // 86400/60 = 1440 messages, and 1440 * 15 = 21,600 cap.
    expect(capIsTheBindingLimit(settings({ xpDailyCap: 21_600 }))).toBe(false);
  });
});

describe("cooldownMinutes", () => {
  it("converts seconds to minutes", () => {
    expect(cooldownMinutes(60)).toBe(1);
    expect(cooldownMinutes(300)).toBe(5);
  });

  it("rounds to one decimal rather than showing 1.6667", () => {
    expect(cooldownMinutes(100)).toBe(1.7);
  });

  it("handles zero", () => {
    expect(cooldownMinutes(0)).toBe(0);
  });
});