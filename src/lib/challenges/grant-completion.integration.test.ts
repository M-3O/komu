import { randomUUID } from "node:crypto";

import { PrismaClient, type Prisma } from "@prisma/client";
import type { GuildMember } from "discord.js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PAYOUT_TEST_HOST, payoutTestUrl, preflightPayoutDatabase } from "@/test/payout-postgres-preflight";

const state = vi.hoisted(() => ({
  client: null as PrismaClient | null,
  addRole: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: new Proxy({}, {
    get: (_target, key) => {
      const value = Reflect.get(state.client!, key);
      return typeof value === "function" ? value.bind(state.client) : value;
    },
  }),
}));
vi.mock("@/bot/services/moderation", () => ({ addRoleToMember: state.addRole }));
vi.mock("@/lib/logger", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn() }) }));

import { grantChallengeCompletions } from "./grant-completion";

/**
 * Real PostgreSQL locks/transactions, not the offline transaction model.
 * EXCLUDED from npm test. Do not run without explicit operator approval to
 * create/delete isolated fixtures on the selected Neon test branch.
 * No Discord requests are made, even when this suite is explicitly enabled.
 */
let base: PrismaClient | undefined;
let observer: PrismaClient | undefined;
let verified = false;
let fixtureDiscordId: string | undefined;
let guildId: string | undefined;
let memberId: string;
let progressId: string;
let discordId: string;

beforeAll(async () => {
  const url = payoutTestUrl(process.env);
  base = new PrismaClient({ datasourceUrl: url });
  await preflightPayoutDatabase(base);
  // A separate observer can inspect lock waits without using either payout connection.
  observer = new PrismaClient({ datasourceUrl: url });
  verified = true;
  console.info("Payout preflight passed:", {
    target: "neon-test", hostname: PAYOUT_TEST_HOST, database: "neondb", schema: "public",
  });
  state.client = base;
});

beforeEach(async () => {
  guildId = undefined;
  fixtureDiscordId = undefined;
  if (!verified) throw new Error("Payout fixtures require successful read-only preflight.");
  state.client = base!;
  state.addRole.mockReset().mockResolvedValue({ ok: true });
  const seed = randomUUID();
  // Preassign both cleanup keys, including if creation's acknowledgement is lost.
  guildId = randomUUID();
  fixtureDiscordId = `payout-guild-${seed}`;
  await base!.guild.create({
    data: { id: guildId, discordId: fixtureDiscordId, name: "Integration: atomic challenge payouts", xpDailyCap: 1 },
  });
  discordId = `payout-member-${seed}`;
  const member = await base!.guildMember.create({
    data: { guildId, discordId, username: "Payout fixture" },
  });
  memberId = member.id;
  const challenge = await base!.challenge.create({
    data: { guildId, name: "Atomic payout", xpReward: 250, rewardRoleId: "test-role", rewardRoleName: "Winner" },
  });
  const progress = await base!.challengeProgress.create({
    data: { guildId, memberId, challengeId: challenge.id, completedAt: new Date() },
  });
  progressId = progress.id;
});

afterEach(async () => {
  state.client = base ?? null;
  // Never let an undefined id turn cleanup into an unfiltered delete.
  if (verified && base && guildId && fixtureDiscordId) {
    await base.guild.deleteMany({ where: { id: guildId, discordId: fixtureDiscordId } });
    expect(await base.guild.count({ where: { id: guildId, discordId: fixtureDiscordId } })).toBe(0);
  }
});

afterAll(async () => { await Promise.all([base?.$disconnect(), observer?.$disconnect()]); });

type TransactionOptions = { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel };

/** Preserve real queries/transactions; intercept only deliberate fault gates. */
function instrument(options: {
  candidates?: () => Promise<void>;
  entered?: (tx: Prisma.TransactionClient) => Promise<void>;
  beforeMarker?: (tx: Prisma.TransactionClient) => Promise<void>;
  afterBody?: (tx: Prisma.TransactionClient) => Promise<void>;
}) {
  const client = base!;
  state.client = new Proxy(client, {
    get(target, key) {
      if (key === "challengeProgress") {
        return new Proxy(target.challengeProgress, {
          get(delegate, method) {
            if (method === "findMany") return async (args: Prisma.ChallengeProgressFindManyArgs) => {
              const rows = await delegate.findMany(args);
              await options.candidates?.();
              return rows;
            };
            const value = Reflect.get(delegate, method);
            return typeof value === "function" ? value.bind(delegate) : value;
          },
        });
      }
      if (key === "$transaction") {
        return (operation: (tx: Prisma.TransactionClient) => Promise<unknown>, settings: TransactionOptions) =>
          target.$transaction(async (tx) => {
            await options.entered?.(tx);
            const wrapped = new Proxy(tx, {
              get(transaction, property) {
                if (property === "challengeProgress") {
                  return new Proxy(transaction.challengeProgress, {
                    get(delegate, method) {
                      if (method === "updateMany") return async (args: Prisma.ChallengeProgressUpdateManyArgs) => {
                        await options.beforeMarker?.(tx);
                        return delegate.updateMany(args);
                      };
                      const value = Reflect.get(delegate, method);
                      return typeof value === "function" ? value.bind(delegate) : value;
                    },
                  });
                }
                const value = Reflect.get(transaction, property);
                return typeof value === "function" ? value.bind(transaction) : value;
              },
            });
            const result = await operation(wrapped);
            await options.afterBody?.(tx);
            return result;
          }, settings);
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

const payout = () => grantChallengeCompletions({
  member: { id: discordId } as GuildMember,
  guildId: guildId!,
});

async function expectState(xp: number, count: number, paid: boolean, client: Prisma.TransactionClient = base!) {
  const [member, detail, progress, ledger] = await Promise.all([
    client.guildMember.findUniqueOrThrow({ where: { id: memberId } }),
    client.memberXP.findUnique({ where: { memberId } }),
    client.challengeProgress.findUniqueOrThrow({ where: { id: progressId } }),
    client.xPTransaction.findMany({ where: { memberId } }),
  ]);
  expect(member.xp).toBe(xp);
  expect(member.xpToday).toBe(xp);
  expect(detail?.totalXp ?? 0).toBe(xp);
  if (count === 0) expect(detail).toBeNull();
  if (count > 0) {
    expect(detail?.level).toBe(member.level);
    expect(ledger[0].source).toBe("CHALLENGE");
    expect(ledger[0].guildId).toBe(guildId);
  }
  expect(ledger).toHaveLength(count);
  expect(ledger.reduce((sum, entry) => sum + entry.amount, 0)).toBe(xp);
  expect(progress.rewardGivenAt !== null).toBe(paid);
}

function rendezvous() {
  let arrivals = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  return async () => {
    if (++arrivals === 2) release();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([ready, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Two concurrent database sessions are required.")), 5_000);
      })]);
    } finally { clearTimeout(timer); }
  };
}

async function injectDatabaseFailure(tx: Prisma.TransactionClient): Promise<string> {
  try {
    await tx.$executeRaw`SELECT 1 / 0`;
    return "not-injected";
  } catch (error) {
    const code = (error as { meta?: { code?: string } }).meta?.code ?? "unknown";
    return code;
  }
}

describe("challenge payout PostgreSQL atomicity", () => {
  it("pays once when both handlers have read the same unpaid completion", async () => {
    const bothRead = rendezvous();
    const bothTransactionsOpen = rendezvous();
    const backends: number[] = [];
    let observedLockWait = false;
    instrument({
      candidates: bothRead,
      entered: async (tx) => {
        const [session] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        backends.push(session.pid);
        await bothTransactionsOpen();
      },
      beforeMarker: async (tx) => {
        await expectState(250, 1, false, tx);
        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline) {
          const waits = await observer!.$queryRaw<Array<{ blocked: boolean }>>`
            SELECT cardinality(pg_blocking_pids(pid)) > 0 AS blocked
            FROM pg_stat_activity WHERE pid IN (${backends[0]}, ${backends[1]})
          `;
          if (waits.some((row) => row.blocked)) { observedLockWait = true; return; }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error("The competing payout never blocked on a PostgreSQL lock.");
      },
    });
    const results = await Promise.all([payout(), payout()]);
    expect(backends).toHaveLength(2);
    expect(new Set(backends).size).toBe(2);
    expect(observedLockWait).toBe(true);
    expect(results.flatMap((r) => r.partial)).toEqual([]);
    await expectState(250, 1, true);
    expect(results.flatMap((r) => r.granted)).toEqual(["Atomic payout"]);
    expect(results.reduce((n, r) => n + r.alreadyGiven, 0)).toBe(1);
    expect(state.addRole).toHaveBeenCalledTimes(1);
    await payout();
    expect(state.addRole).toHaveBeenCalledTimes(1);
    await expectState(250, 1, true);
  });

  it("rolls back real XP writes when PostgreSQL fails before the payout marker", async () => {
    let reached = 0;
    let failure = "";
    instrument({ beforeMarker: async (tx) => {
      await expectState(250, 1, false, tx);
      reached++;
      failure = await injectDatabaseFailure(tx);
      throw new Error("Injected PostgreSQL failure before payout marker.");
    } });
    expect((await payout()).partial).toHaveLength(1);
    expect(reached).toBe(1);
    expect(failure).toBe("22012");
    await expectState(0, 0, false);
    expect(state.addRole).not.toHaveBeenCalled();
    state.client = base!;
    expect((await payout()).granted).toEqual(["Atomic payout"]);
    await expectState(250, 1, true);
    await payout();
    await expectState(250, 1, true);
    expect(state.addRole).toHaveBeenCalledTimes(1);
  });

  it("rolls back both the marker and XP after all payout statements succeeded", async () => {
    let reached = 0;
    let failure = "";
    instrument({ afterBody: async (tx) => {
      await expectState(250, 1, true, tx);
      reached++;
      failure = await injectDatabaseFailure(tx);
      throw new Error("Injected PostgreSQL failure after payout marker.");
    } });
    expect((await payout()).partial).toHaveLength(1);
    expect(reached).toBe(1);
    expect(failure).toBe("22012");
    await expectState(0, 0, false);
    expect(state.addRole).not.toHaveBeenCalled();
    state.client = base!;
    expect((await payout()).granted).toEqual(["Atomic payout"]);
    await payout();
    await expectState(250, 1, true);
    expect(state.addRole).toHaveBeenCalledTimes(1);
  });

  it("calls Discord only after the payout is durably committed", async () => {
    state.addRole.mockImplementation(async () => {
      await expectState(250, 1, true);
      return { ok: true };
    });
    expect((await payout()).granted).toEqual(["Atomic payout"]);
    await payout();
    await expectState(250, 1, true);
    expect(state.addRole).toHaveBeenCalledTimes(1);
  });
});
