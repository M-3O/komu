import type { GuildMember } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findMember,
  applyRoles,
  grantRewards,
  updateProgress,
  grantPayouts,
  announce,
  unlock,
  logError,
} = vi.hoisted(() => ({
  findMember: vi.fn(),
  applyRoles: vi.fn(),
  grantRewards: vi.fn(),
  updateProgress: vi.fn(),
  grantPayouts: vi.fn(),
  announce: vi.fn(),
  unlock: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { guildMember: { findFirst: findMember } },
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: logError,
  }),
}));

vi.mock("@/lib/achievements/unlock", () => ({
  unlockAchievementsForMember: unlock,
}));

vi.mock("@/lib/challenges/announce-completion", () => ({
  announceChallengeCompletions: announce,
}));

vi.mock("@/lib/challenges/grant-completion", () => ({
  grantChallengeCompletions: grantPayouts,
}));

vi.mock("@/lib/challenges/record-progress", () => ({
  updateChallengeProgress: updateProgress,
}));

vi.mock("@/lib/roles/apply-rules", () => ({
  applyRoleRulesForMember: applyRoles,
}));

vi.mock("@/lib/rewards/grant", () => ({
  grantEligibleRewards: grantRewards,
}));

import { applyProgressionForMember } from "./progression";

const member = {
  id: "discord-user-1",
  guild: { id: "guild-1" },
} as unknown as GuildMember;

beforeEach(() => {
  vi.clearAllMocks();

  findMember.mockResolvedValue({ id: "member-db-1", level: 3 });
  applyRoles.mockResolvedValue({
    assigned: [],
    failed: [],
    alreadyHeld: 0,
    unsatisfied: 0,
  });
  grantRewards.mockResolvedValue({ granted: [], failed: [], skipped: 0 });
  updateProgress.mockResolvedValue({
    updated: [],
    completed: [],
    expired: 0,
    skippedNoRequirements: 0,
    unrelated: 0,
  });
  grantPayouts.mockResolvedValue({
    granted: [],
    partial: [],
    alreadyGiven: 0,
  });
  unlock.mockResolvedValue({ unlocked: [], partial: [], skipped: 0 });
});

describe("applyProgressionForMember", () => {
  it("continues announcements and achievements after a retryable payout failure", async () => {
    grantPayouts.mockResolvedValue({
      granted: [],
      partial: [{ challenge: "Atomic payout", reason: "transaction rolled back" }],
      alreadyGiven: 0,
    });
    announce.mockResolvedValue({
      announced: [], failed: [], skippedNoChannel: 0, skippedDuplicate: 0,
    });

    const result = await applyProgressionForMember(member, "guild-db-1", {
      activity: { kind: "MESSAGE" },
    });

    expect(result.challenges.payouts.partial).toEqual([
      { challenge: "Atomic payout", reason: "transaction rolled back" },
    ]);
    expect(announce).toHaveBeenCalledWith({ member, guildId: "guild-db-1" });
    expect(unlock).toHaveBeenCalledWith({ member, guildId: "guild-db-1" });
  });

  it("continues into achievements when announcement processing throws", async () => {
    announce.mockRejectedValue(new Error("announcement database unavailable"));

    const result = await applyProgressionForMember(member, "guild-db-1", {
      activity: { kind: "MESSAGE" },
    });

    expect(result.challenges.announcements.failed).toEqual([
      { challenge: "announcement check", reason: "announcement database unavailable" },
    ]);
    expect(result.challenges.payouts).toEqual({
      granted: [],
      partial: [],
      alreadyGiven: 0,
    });
    expect(grantPayouts).toHaveBeenCalledTimes(1);
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(
      "Challenge announcement check failed",
      expect.objectContaining({ guildId: "guild-db-1" }),
    );
  });
});
