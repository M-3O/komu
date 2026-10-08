import { describe, expect, it } from "vitest";

import {
  ACTIONS_FOR_TYPE,
  ACTION_LABELS,
  describeRuleConfig,
  RULE_TYPES,
  RULE_TYPE_LABELS,
} from "./rule-config";

/**
 * Moderation rule configuration.
 *
 * The pairing rules matter because the schema allows any action for any type.
 * Banning someone for a word-filter match is almost never intended, so it is
 * not offered rather than offered and regretted.
 */

describe("rule types", () => {
  it("offers the three V1 types", () => {
    expect(RULE_TYPES).toEqual(["WORD_FILTER", "SPAM", "RAID_PROTECTION"]);
  });

  it("has a label for each", () => {
    for (const type of RULE_TYPES) {
      expect(RULE_TYPE_LABELS[type]).toBeTruthy();
    }
  });
});

describe("ACTIONS_FOR_TYPE", () => {
  it("never offers kicking or banning from a word filter", () => {
    expect(ACTIONS_FOR_TYPE.WORD_FILTER).toEqual(["DELETE_MESSAGE", "WARN"]);
    expect(ACTIONS_FOR_TYPE.WORD_FILTER).not.toContain("KICK");
    expect(ACTIONS_FOR_TYPE.WORD_FILTER).not.toContain("BAN");
  });

  it("never offers banning from raid protection", () => {
    // Banning a whole raid automatically is how a protection tool becomes the
    // incident.
    expect(ACTIONS_FOR_TYPE.RAID_PROTECTION).not.toContain("BAN");
  });

  it("never offers timeout from a word filter", () => {
    expect(ACTIONS_FOR_TYPE.WORD_FILTER).not.toContain("TIMEOUT");
  });

  it("offers at least one action for every type", () => {
    for (const type of RULE_TYPES) {
      expect(ACTIONS_FOR_TYPE[type].length).toBeGreaterThan(0);
    }
  });

  it("only names actions that have labels", () => {
    for (const type of RULE_TYPES) {
      for (const action of ACTIONS_FOR_TYPE[type]) {
        expect(ACTION_LABELS[action]).toBeTruthy();
      }
    }
  });
});

describe("describeRuleConfig", () => {
  it("summarises a word filter and lists the words", () => {
    const summary = describeRuleConfig({
      type: "WORD_FILTER",
      action: "DELETE_MESSAGE",
      blockedWords: ["badword", "spam-link"],
      messageLimit: null,
      windowSeconds: null,
      joinThreshold: null,
      joinWindowSeconds: null,
      actionDurationMins: null,
    });

    expect(summary).toBe("delete the message when a message contains badword, spam-link");
  });

  it("counts the words it does not list", () => {
    const words = Array.from({ length: 8 }, (_, index) => `word${index}`);

    const summary = describeRuleConfig({
      type: "WORD_FILTER",
      action: "WARN",
      blockedWords: words,
      messageLimit: null,
      windowSeconds: null,
      joinThreshold: null,
      joinWindowSeconds: null,
      actionDurationMins: null,
    });

    expect(summary).toContain("word0");
    expect(summary).toContain("and 3 more");
    expect(summary).not.toContain("word7");
  });

  it("summarises a spam rule with its timeout", () => {
    const summary = describeRuleConfig({
      type: "SPAM",
      action: "TIMEOUT",
      blockedWords: [],
      messageLimit: 5,
      windowSeconds: 30,
      joinThreshold: null,
      joinWindowSeconds: null,
      actionDurationMins: 10,
    });

    expect(summary).toBe("timeout the member after 5 messages in 30s for 10m");
  });

  it("summarises a raid rule with its timeout", () => {
    const summary = describeRuleConfig({
      type: "RAID_PROTECTION",
      action: "TIMEOUT",
      blockedWords: [],
      messageLimit: null,
      windowSeconds: null,
      joinThreshold: 5,
      joinWindowSeconds: 30,
      actionDurationMins: 60,
    });

    expect(summary).toBe("timeout the member when 5 members join in 30s for 60m");
  });

  it("omits the duration when the action is not a timeout", () => {
    const summary = describeRuleConfig({
      type: "SPAM",
      action: "KICK",
      blockedWords: [],
      messageLimit: 5,
      windowSeconds: 30,
      joinThreshold: null,
      joinWindowSeconds: null,
      actionDurationMins: null,
    });

    expect(summary).toBe("kick the member after 5 messages in 30s");
    expect(summary).not.toContain("for ");
  });
});