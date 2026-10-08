import { describe, expect, it } from "vitest";

import {
  cooldownElapsed,
  evaluateEligibility,
  hashMessage,
  isExcessiveRepeat,
  meetsMinimumLength,
  REPEAT_ALLOWANCE,
} from "./message-xp";

/**
 * The anti-abuse rules from PRD section 7.5. These are the tests that stop a
 * bot farming XP from a single account.
 */

describe("meetsMinimumLength", () => {
  it("accepts a message at the minimum", () => {
    expect(meetsMinimumLength("lol", 3)).toBe(true);
  });

  it("rejects a message below the minimum", () => {
    expect(meetsMinimumLength("lo", 3)).toBe(false);
  });

  it("trims before measuring", () => {
    expect(meetsMinimumLength("   lol   ", 3)).toBe(true);
    expect(meetsMinimumLength("      ", 3)).toBe(false);
  });

  it("treats a zero or negative minimum as one character", () => {
    expect(meetsMinimumLength("a", 0)).toBe(true);
    expect(meetsMinimumLength("", 0)).toBe(false);
  });
});

describe("cooldownElapsed", () => {
  const now = new Date("2024-05-17T12:00:00Z");

  it("is true when the member has never earned XP", () => {
    expect(cooldownElapsed(null, 60, now)).toBe(true);
  });

  it("is false straight after an award", () => {
    expect(cooldownElapsed(new Date("2024-05-17T11:59:30Z"), 60, now)).toBe(false);
  });

  it("is true once the cooldown has passed", () => {
    expect(cooldownElapsed(new Date("2024-05-17T11:58:00Z"), 60, now)).toBe(true);
  });

  it("is true exactly at the boundary", () => {
    expect(cooldownElapsed(new Date("2024-05-17T11:59:00Z"), 60, now)).toBe(true);
  });

  it("is always true when no cooldown is configured", () => {
    expect(cooldownElapsed(new Date("2024-05-17T11:59:59Z"), 0, now)).toBe(true);
  });
});

describe("isExcessiveRepeat", () => {
  it("is false for a first-time message", () => {
    expect(isExcessiveRepeat("abc", null, 0)).toBe(false);
  });

  it("is false when the message differs from the last one", () => {
    expect(isExcessiveRepeat("abc", "def", 5)).toBe(false);
  });

  it("allows a couple of repeats", () => {
    // count 0 and 1 are within the allowance.
    expect(isExcessiveRepeat("abc", "abc", 0)).toBe(false);
    expect(isExcessiveRepeat("abc", "abc", 1)).toBe(false);
  });

  it("blocks once the allowance is used up", () => {
    expect(isExcessiveRepeat("abc", "abc", REPEAT_ALLOWANCE)).toBe(true);
    expect(isExcessiveRepeat("abc", "abc", REPEAT_ALLOWANCE + 1)).toBe(true);
  });

  it("honours a custom allowance", () => {
    expect(isExcessiveRepeat("abc", "abc", 1, 1)).toBe(true);
    expect(isExcessiveRepeat("abc", "abc", 0, 1)).toBe(false);
  });
});

describe("hashMessage", () => {
  it("is stable for the same text", () => {
    expect(hashMessage("hello there")).toBe(hashMessage("hello there"));
  });

  it("ignores case and repeated whitespace", () => {
    expect(hashMessage("Hello   There")).toBe(hashMessage("hello there"));
    expect(hashMessage("  hello  ")).toBe(hashMessage("hello"));
  });

  it("differs for different text", () => {
    expect(hashMessage("hello")).not.toBe(hashMessage("goodbye"));
  });

  it("returns a short hex string", () => {
    expect(hashMessage("anything")).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("evaluateEligibility", () => {
  const base = {
    xpEnabled: true,
    xpMessageMinLength: 3,
    xpMessageCooldownSecs: 60,
    message: "a real message",
    lastXpMessageAt: null,
    lastMessageHash: null,
    lastMessageRepeatCount: 0,
  };

  it("accepts a normal message", () => {
    expect(evaluateEligibility(base)).toEqual({ eligible: true });
  });

  it("refuses everything when XP is disabled", () => {
    const result = evaluateEligibility({ ...base, xpEnabled: false });

    expect(result).toEqual({ eligible: false, reason: "XP_DISABLED" });
  });

  it("refuses a short message", () => {
    const result = evaluateEligibility({ ...base, message: "hi" });

    expect(result).toEqual({ eligible: false, reason: "TOO_SHORT" });
  });

  it("refuses a message inside the cooldown", () => {
    const result = evaluateEligibility({
      ...base,
      lastXpMessageAt: new Date(),
    });

    expect(result).toEqual({ eligible: false, reason: "ON_COOLDOWN" });
  });

  it("refuses an over-repeated message", () => {
    const result = evaluateEligibility({
      ...base,
      message: "lol",
      xpMessageMinLength: 1,
      lastMessageHash: hashMessage("lol"),
      lastMessageRepeatCount: REPEAT_ALLOWANCE,
    });

    expect(result).toEqual({ eligible: false, reason: "REPEATED" });
  });

  it("allows the same message again once the hash changes", () => {
    const result = evaluateEligibility({
      ...base,
      lastMessageHash: hashMessage("something else"),
      lastMessageRepeatCount: REPEAT_ALLOWANCE,
    });

    expect(result).toEqual({ eligible: true });
  });

  it("checks length before repeat, so 'hi' is reported as too short", () => {
    const result = evaluateEligibility({
      ...base,
      message: "hi",
      lastMessageHash: hashMessage("hi"),
      lastMessageRepeatCount: 99,
    });

    expect(result).toEqual({ eligible: false, reason: "TOO_SHORT" });
  });
});