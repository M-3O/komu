import type { GuildMember } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { HealthRegistry, health } from "@/lib/monitoring/health";

import { applyProgressionForMember, tryApplyProgression } from "./progression";

const member = {
  id: "discord-user-1",
  guild: { id: "guild-1" },
} as unknown as GuildMember;

let registry: HealthRegistry;
afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  vi.clearAllMocks();
  registry = new HealthRegistry();
  vi.spyOn(health, "begin").mockImplementation(registry.begin.bind(registry));
  announce.mockResolvedValue({ announced: [], failed: [], skippedNoChannel: 0, skippedDuplicate: 0 });

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


describe("progression monitoring does not replay business work", () => {
  it("keeps payout failure visible when announcements and achievements succeed", async () => {
    grantPayouts.mockResolvedValue({ granted: [], partial: [{ challenge: "canary-secret", reason: "postgresql://canary-secret" }], alreadyGiven: 0 });
    announce.mockResolvedValue({ announced: [{ challenge: "challenge", messageId: "message" }], failed: [], skippedNoChannel: 0, skippedDuplicate: 0 });
    unlock.mockResolvedValue({ unlocked: [{ id: "achievement", name: "achievement", icon: "star" }], partial: [], skipped: 0 });
    const result = await tryApplyProgression(member, "guild-db-1", { activity: { kind: "MESSAGE" } });
    expect(result?.challenges.payouts.partial).toHaveLength(1);
    expect(registry.snapshot().find(s => s.component === "job.challenge-payout")).toMatchObject({ state: "degraded", lastError: "JOB_PARTIAL" });
    expect(registry.snapshot().find(s => s.component === "job.challenge-announcement")?.state).toBe("healthy");
    expect(registry.snapshot().find(s => s.component === "job.progression")?.state).toBe("degraded");
    expect(JSON.stringify(registry.snapshot())).not.toContain("canary-secret");
    for (const operation of [grantPayouts, announce, unlock, updateProgress, applyRoles, grantRewards]) expect(operation).toHaveBeenCalledTimes(1);
  });
  it("does not clear an announcement incident on a duplicate/no-channel skip", async () => {
    announce.mockResolvedValueOnce({ announced: [], failed: [{ challenge: "challenge", reason: "secret" }], skippedNoChannel: 0, skippedDuplicate: 0 });
    await applyProgressionForMember(member, "guild-db-1", { activity: { kind: "MESSAGE" } });
    announce.mockResolvedValueOnce({ announced: [], failed: [], skippedNoChannel: 1, skippedDuplicate: 1 });
    await applyProgressionForMember(member, "guild-db-1", { activity: { kind: "MESSAGE" } });
    expect(registry.snapshot().find(s => s.component === "job.challenge-announcement")).toMatchObject({ state: "degraded", consecutiveFailures: 1 });
    expect(announce).toHaveBeenCalledTimes(2);
  });
  it("preserves progression and one announcement attempt when monitoring breaks", async () => {
    vi.spyOn(health, "begin").mockImplementation(() => { throw Error("observer failure"); });
    const result = await applyProgressionForMember(member, "guild-db-1", { activity: { kind: "MESSAGE" } });
    expect(result.challenges.payouts).toEqual({ granted: [], partial: [], alreadyGiven: 0 });
    expect(announce).toHaveBeenCalledTimes(1); expect(grantPayouts).toHaveBeenCalledTimes(1);
    expect(unlock).toHaveBeenCalledTimes(1);
  });
  it("records thrown database failures while preserving the nullable event result", async () => {
    findMember.mockRejectedValue({ code: "P1001", message: "secret" });
    expect(await tryApplyProgression(member, "guild-db-1", { activity: { kind: "MESSAGE" } })).toBeNull();
    expect(registry.snapshot().find(s => s.component === "database.progression")?.lastError).toBe("DATABASE_UNREACHABLE");
    expect(announce).not.toHaveBeenCalled();
    findMember.mockResolvedValue({ id: "member-db-1", level: 3 });
  });
});
