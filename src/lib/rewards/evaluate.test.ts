import { ProgressionMetric } from "@prisma/client";
import { describe, expect, it } from "vitest";

import type { MemberStats } from "@/lib/progression/metrics";
import {
  conditionMet,
  describeReward,
  evaluateReward,
  partitionByEligibility,
  type ExistingGrant,
  type RewardInput,
} from "./evaluate";

/**
 * PRD section 7.8: eligible members get the reward, and the same reward is not
 * granted twice unless it is meant to repeat.
 *
 * These are the rules that hand out real XP and real roles, so they are tested
 * without a database.
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

function reward(overrides: Partial<RewardInput> = {}): RewardInput {
  return {
    id: "reward-1",
    name: "Stream Regular",
    enabled: true,
    conditionMetric: ProgressionMetric.STREAM_ATTENDANCE,
    conditionThreshold: 5,
    repeatable: false,
    actions: [{ type: "GIVE_XP" }],
    ...overrides,
  };
}

const MEMBER = "member-1";

describe("conditionMet", () => {
  it("is true at the threshold", () => {
    const rule = reward({ conditionThreshold: 5 });
    expect(conditionMet(rule, stats({ streamAttendanceCount: 5 }), NOW)).toBe(true);
  });

  it("is false one short", () => {
    const rule = reward({ conditionThreshold: 5 });
    expect(conditionMet(rule, stats({ streamAttendanceCount: 4 }), NOW)).toBe(false);
  });

  it("works for each supported metric", () => {
    const member = stats({
      xp: 4000,
      level: 12,
      messageCount: 300,
      streamAttendanceCount: 8,
    });

    expect(
      conditionMet(reward({ conditionMetric: ProgressionMetric.XP, conditionThreshold: 4000 }), member, NOW),
    ).toBe(true);
    expect(
      conditionMet(reward({ conditionMetric: ProgressionMetric.LEVEL, conditionThreshold: 12 }), member, NOW),
    ).toBe(true);
    expect(
      conditionMet(
        reward({ conditionMetric: ProgressionMetric.MESSAGE_COUNT, conditionThreshold: 301 }),
        member,
        NOW,
      ),
    ).toBe(false);
  });
});

describe("evaluateReward", () => {
  it("grants a reward the member qualifies for", () => {
    const result = evaluateReward(reward(), stats({ streamAttendanceCount: 5 }), [], MEMBER, NOW);
    expect(result).toEqual({ eligible: true });
  });

  it("does not grant a disabled reward", () => {
    const result = evaluateReward(
      reward({ enabled: false }),
      stats({ streamAttendanceCount: 99 }),
      [],
      MEMBER,
      NOW,
    );

    expect(result).toEqual({ eligible: false, reason: "DISABLED" });
  });

  it("does not grant a reward the member has not earned", () => {
    const result = evaluateReward(reward(), stats({ streamAttendanceCount: 2 }), [], MEMBER, NOW);
    expect(result).toEqual({ eligible: false, reason: "NOT_MET" });
  });

  it("does not grant a reward with no actions", () => {
    // Otherwise it records a grant and does nothing, which looks like it
    // worked and never will.
    const result = evaluateReward(
      reward({ actions: [] }),
      stats({ streamAttendanceCount: 99 }),
      [],
      MEMBER,
      NOW,
    );

    expect(result).toEqual({ eligible: false, reason: "NO_ACTIONS" });
  });

  it("does not grant a one-shot reward twice", () => {
    const grants: ExistingGrant[] = [{ rewardId: "reward-1", memberId: MEMBER }];

    const result = evaluateReward(
      reward({ repeatable: false }),
      stats({ streamAttendanceCount: 5 }),
      grants,
      MEMBER,
      NOW,
    );

    expect(result).toEqual({ eligible: false, reason: "ALREADY_GRANTED" });
  });

  it("grants a repeatable reward again", () => {
    const grants: ExistingGrant[] = [{ rewardId: "reward-1", memberId: MEMBER }];

    const result = evaluateReward(
      reward({ repeatable: true }),
      stats({ streamAttendanceCount: 5 }),
      grants,
      MEMBER,
      NOW,
    );

    expect(result).toEqual({ eligible: true });
  });

  it("ignores a grant made for a different member", () => {
    const grants: ExistingGrant[] = [{ rewardId: "reward-1", memberId: "someone-else" }];

    const result = evaluateReward(
      reward(),
      stats({ streamAttendanceCount: 5 }),
      grants,
      MEMBER,
      NOW,
    );

    expect(result).toEqual({ eligible: true });
  });

  it("ignores a grant of a different reward", () => {
    const grants: ExistingGrant[] = [{ rewardId: "other-reward", memberId: MEMBER }];

    const result = evaluateReward(
      reward(),
      stats({ streamAttendanceCount: 5 }),
      grants,
      MEMBER,
      NOW,
    );

    expect(result).toEqual({ eligible: true });
  });

  it("stays granted exactly once across repeated checks", () => {
    // Simulates a member sending many messages: the reward should fire once,
    // not once per message.
    let granted = 0;
    const grants: ExistingGrant[] = [];

    for (let pass = 0; pass < 10; pass++) {
      const result = evaluateReward(reward(), stats({ streamAttendanceCount: 5 }), grants, MEMBER, NOW);

      if (result.eligible) {
        granted += 1;
        grants.push({ rewardId: "reward-1", memberId: MEMBER });
      }
    }

    expect(granted).toBe(1);
  });

  it("can fire again for a repeatable reward on later checks", () => {
    let granted = 0;
    const grants: ExistingGrant[] = [];

    for (let pass = 0; pass < 5; pass++) {
      const result = evaluateReward(
        reward({ repeatable: true }),
        stats({ streamAttendanceCount: 5 }),
        grants,
        MEMBER,
        NOW,
      );

      if (result.eligible) {
        granted += 1;
        grants.push({ rewardId: "reward-1", memberId: MEMBER });
      }
    }

    expect(granted).toBe(5);
  });
});

describe("partitionByEligibility", () => {
  it("splits a mixed set", () => {
    const rules = [
      reward({ id: "a", conditionThreshold: 5 }),
      reward({ id: "b", conditionThreshold: 50 }),
      reward({ id: "c", conditionThreshold: 3, repeatable: true }),
      reward({ id: "d", conditionThreshold: 1, enabled: false }),
    ];

    const result = partitionByEligibility(
      rules,
      stats({ streamAttendanceCount: 6 }),
      [{ rewardId: "c", memberId: MEMBER }],
      MEMBER,
      NOW,
    );

    expect(result.eligible.map((r) => r.id).sort()).toEqual(["a", "c"]);
    expect(result.skipped.map((s) => s.reason).sort()).toEqual(["DISABLED", "NOT_MET"]);
  });

  it("returns nothing for no rewards", () => {
    const result = partitionByEligibility([], stats({ level: 999 }), [], MEMBER, NOW);

    expect(result.eligible).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });
});

describe("describeReward", () => {
  it("reads as a sentence", () => {
    expect(describeReward(reward({ conditionThreshold: 5 }))).toBe(
      "Stream Regular (5 streams)",
    );
  });

  it("uses the unit of the reward's own metric", () => {
    expect(
      describeReward(
        reward({ conditionMetric: ProgressionMetric.MEMBER_AGE_DAYS, conditionThreshold: 30 }),
      ),
    ).toBe("Stream Regular (30 days in server)");
  });
});