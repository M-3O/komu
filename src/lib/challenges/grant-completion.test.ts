import type { GuildMember } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rendezvous, TransactionalPayoutStore, type PayoutFailure } from "@/test/transactional-payout-store";

const state = vi.hoisted(() => ({
  store: null as TransactionalPayoutStore | null,
  addRole: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: new Proxy({}, {
    get: (_target, key) => Reflect.get(state.store!.api, key),
  }),
}));
vi.mock("@/bot/services/moderation", () => ({ addRoleToMember: state.addRole }));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// Deliberately do not mock awardXp: the real ledger and cached-total writes
// must share the payout's transaction, or rollback assertions below fail.
import { health } from "@/lib/monitoring/health";

import { awardXp } from "@/lib/xp/award-xp";
import { grantChallengeCompletions } from "./grant-completion";

afterEach(() => vi.restoreAllMocks());

let store: TransactionalPayoutStore;
const member = (id = "member-1") => ({ id: `discord-${id}` }) as GuildMember;
const input = () => ({ member: member(), guildId: "guild-1" });

beforeEach(() => {
  store = new TransactionalPayoutStore();
  state.store = store;
  state.addRole.mockReset().mockResolvedValue({ ok: true });
});

function expectUnpaid() {
  expect(store.progress.get("progress-1")?.rewardGivenAt).toBeNull();
  expect(store.members.get("member-1")?.xp).toBe(0);
  expect(store.members.get("member-1")?.xpToday).toBe(0);
  expect(store.ledger).toEqual([]);
  expect(store.details.size).toBe(0);
  expect(state.addRole).not.toHaveBeenCalled();
}

function expectPaidOnce() {
  expect(store.progress.get("progress-1")?.rewardGivenAt).toBeInstanceOf(Date);
  expect(store.members.get("member-1")?.xp).toBe(250);
  expect(store.members.get("member-1")?.xpToday).toBe(250);
  expect(store.ledger).toHaveLength(1);
  expect(store.ledger[0]).toMatchObject({ amount: 250, source: "CHALLENGE", reason: "Challenge complete: Challenge 1" });
  expect(store.details.get("member-1")?.totalXp).toBe(250);
  expect(store.details.get("member-1")?.level).toBe(store.members.get("member-1")?.level);
}

describe("atomic challenge payouts (offline row-lock/rollback model)", () => {
  it("awards once when both handlers read the unpaid completion simultaneously", async () => {
    store.beforeCandidates = rendezvous(2);
    const results = await Promise.all([
      grantChallengeCompletions(input()),
      grantChallengeCompletions(input()),
    ]);
    expectPaidOnce();
    expect(store.transactionsStarted).toBe(2);
    expect(store.lockWaits).toBeGreaterThan(0);
    expect(results.flatMap((r) => r.granted)).toEqual(["Challenge 1"]);
    expect(results.reduce((count, r) => count + r.alreadyGiven, 0)).toBe(1);
    expect(state.addRole).toHaveBeenCalledTimes(1);
  });

  it("rolls back successful XP writes when the final payout-record update fails", async () => {
    store.failAt = "marker";
    const failed = await grantChallengeCompletions(input());
    expect(failed.partial).toHaveLength(1);
    expect(store.attemptedLedgerWrites).toBe(1);
    expect(store.attemptedMemberWrites).toBe(1);
    expect(store.attemptedDetailWrites).toBe(1);
    expectUnpaid();
    expect((await grantChallengeCompletions(input())).granted).toEqual(["Challenge 1"]);
    expectPaidOnce();
  });

  it.each<PayoutFailure>(["ledger", "member", "detail", "marker-count", "commit"])(
    "leaves no durable partial payout after %s failure and safely retries", async (point) => {
      store.failAt = point;
      expect((await grantChallengeCompletions(input())).partial).toHaveLength(1);
      expectUnpaid();
      expect((await grantChallengeCompletions(input())).granted).toEqual(["Challenge 1"]);
      expectPaidOnce();
    },
  );

  it("lets a waiting contender pay once when the first transaction rolls back", async () => {
    store.beforeCandidates = rendezvous(2);
    store.failAt = "marker";
    const results = await Promise.all([
      grantChallengeCompletions(input()),
      grantChallengeCompletions(input()),
    ]);
    expectPaidOnce();
    expect(results.flatMap((r) => r.partial)).toHaveLength(1);
    expect(results.flatMap((r) => r.granted)).toEqual(["Challenge 1"]);
    expect(state.addRole).toHaveBeenCalledTimes(1);
  });

  it("does not repay after a lost acknowledgement of a successful commit", async () => {
    store.failAt = "commit-unknown";
    expect((await grantChallengeCompletions(input())).partial).toHaveLength(1);
    expectPaidOnce();
    await grantChallengeCompletions(input());
    expectPaidOnce();
  });

  it("preserves the real XP calculations and performs role assignment only after commit", async () => {
    state.addRole.mockImplementation(async () => {
      expect(store.activeTransactions).toBe(0);
      expectPaidOnce();
      return { ok: true };
    });
    expect((await grantChallengeCompletions(input())).granted).toEqual(["Challenge 1"]);
    expect(store.dailyCap).toBe(1); // Deliberate payouts still bypass the cap.
    expect(store.transactionsStarted).toBe(1); // No independent/nested XP commit.
    expect(state.addRole).toHaveBeenCalledWith(member(), "role-1");
  });

  it("preserves role-only payouts", async () => {
    store.challenges.get("challenge-1")!.xpReward = 0;
    expect((await grantChallengeCompletions(input())).granted).toEqual(["Challenge 1"]);
    expect(store.ledger).toEqual([]);
    expect(store.progress.get("progress-1")?.rewardGivenAt).toBeInstanceOf(Date);
    expect(state.addRole).toHaveBeenCalledTimes(1);
  });

  it("preserves XP-only payouts", async () => {
    store.challenges.get("challenge-1")!.rewardRoleId = null;
    await grantChallengeCompletions(input());
    expectPaidOnce();
    expect(state.addRole).not.toHaveBeenCalled();
  });

  it("reports role failure without replaying committed XP on later activity", async () => {
    state.addRole.mockResolvedValue({ ok: false, error: "Missing Permissions" });
    expect((await grantChallengeCompletions(input())).partial).toEqual([
      { challenge: "Challenge 1", reason: "Could not add @Winner: Missing Permissions" },
    ]);
    for (let i = 0; i < 5; i += 1) await grantChallengeCompletions(input());
    expectPaidOnce();
    expect(state.addRole).toHaveBeenCalledTimes(1);
  });

  it("skips previously rewarded completions without changing balances or markers", async () => {
    const paidAt = new Date("2026-01-01T00:00:00Z");
    store.progress.get("progress-1")!.rewardGivenAt = paidAt;
    expect((await grantChallengeCompletions(input())).granted).toEqual([]);
    expect(store.progress.get("progress-1")?.rewardGivenAt).toBe(paidAt);
    expect(store.members.get("member-1")?.xp).toBe(0);
    expect(store.ledger).toEqual([]);
    expect(store.transactionsStarted).toBe(0);
    expect(state.addRole).not.toHaveBeenCalled();
  });

  it("does not duplicate XP or role calls after repeated member activity", async () => {
    for (let i = 0; i < 5; i += 1) await grantChallengeCompletions(input());
    expectPaidOnce();
    expect(state.addRole).toHaveBeenCalledTimes(1);
  });

  it("keeps an unawarded completion retryable when the XP member lookup fails", async () => {
    store.missingXpMember = true;
    expect((await grantChallengeCompletions(input())).partial).toHaveLength(1);
    expectUnpaid();
    store.missingXpMember = false;
    await grantChallengeCompletions(input());
    expectPaidOnce();
  });

  it("serializes different payouts for the same member without losing XP totals", async () => {
    store.seed("2", "member-1");
    store.beforeCandidates = rendezvous(2);
    await Promise.all([
      grantChallengeCompletions({ ...input(), onlyChallengeId: "challenge-1" }),
      grantChallengeCompletions({ ...input(), onlyChallengeId: "challenge-2" }),
    ]);
    expect(store.members.get("member-1")?.xp).toBe(500);
    expect(store.details.get("member-1")?.totalXp).toBe(500);
    expect(store.ledger).toHaveLength(2);
  });

  it("retains the standalone XP service's own transaction and daily-cap behavior", async () => {
    const outcome = await awardXp({ guildId: "guild-1", memberId: "member-1", amount: 15, source: "MESSAGE" });
    expect(outcome.awarded).toBe(1);
    expect(store.members.get("member-1")?.xp).toBe(1);
    expect(store.details.get("member-1")?.totalXp).toBe(1);
    expect(store.progress.get("progress-1")?.rewardGivenAt).toBeNull();
  });

  it("allows unrelated members' transactions to overlap instead of using a global mutex", async () => {
    store.seed("2");
    store.beforeLedgerWrite = rendezvous(2);
    await Promise.all([
      grantChallengeCompletions(input()),
      grantChallengeCompletions({ member: member("member-2"), guildId: "guild-1" }),
    ]);
    expect(store.members.get("member-1")?.xp).toBe(250);
    expect(store.members.get("member-2")?.xp).toBe(250);
    expect(store.ledger).toHaveLength(2);
    expect(store.lockWaits).toBe(0);
  });

  it("negative control: an independent XP transaction survives an outer payout rollback", async () => {
    // Prove the model does not accidentally roll back independently committed
    // XP. This is precisely the old bug; passing the actual transaction to
    // awardXp is necessary for the earlier rollback tests to pass.
    await expect(store.api.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM challenge_progress WHERE id = ${"progress-1"}
        AND "guildId" = ${"guild-1"} AND "memberId" = ${"member-1"} FOR UPDATE`;
      await awardXp({ guildId: "guild-1", memberId: "member-1", amount: 250, source: "CHALLENGE", ignoreDailyCap: true });
      throw new Error("Old non-atomic payout failed after XP committed");
    })).rejects.toThrow("Old non-atomic payout");
    expect(store.progress.get("progress-1")?.rewardGivenAt).toBeNull();
    expect(store.members.get("member-1")?.xp).toBe(250);
    expect(store.ledger).toHaveLength(1);
  });
});


it("preserves row locking and exactly-once XP even when the monitor throws", async () => {
  vi.spyOn(health, "begin").mockImplementation(() => { throw Error("broken observer"); });
  store.beforeCandidates = rendezvous(2);
  await Promise.all([grantChallengeCompletions(input()), grantChallengeCompletions(input())]);
  expectPaidOnce();
  expect(store.lockWaits).toBeGreaterThan(0);
  expect(state.addRole).toHaveBeenCalledTimes(1);
});
