import { XPSource } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { awardXp } from "@/lib/xp/award-xp";
import { prisma } from "@/lib/db";
import { cleanupMember, createTestMember, requireGuild } from "@/test/integration-helpers";

/**
 * XP awards against a real database (PRD section 7.5).
 *
 * Covers what unit tests cannot: that a transaction is written alongside the
 * member total, that the two copies of XP cannot drift, and that the daily cap
 * is actually enforced rather than merely calculated.
 */

const SEED = 800001;

let guild: { id: string; name: string; xpEnabled: boolean };
let member: { id: string; discordId: string; xp: number };

beforeEach(async () => {
  guild = await requireGuild();
  member = await createTestMember(guild.id, SEED, { xp: 0, level: 1 });
});

afterEach(async () => {
  await cleanupMember(guild.id, SEED);
});

describe("awardXp", () => {
  it("writes a transaction and the member total together", async () => {
    const result = await awardXp({
      guildId: guild.id,
      memberId: member.id,
      amount: 40,
      source: XPSource.MESSAGE,
      reason: "integration test",
    });

    expect(result.awarded).toBe(40);

    const transaction = await prisma.xPTransaction.findFirst({
      where: { memberId: member.id },
      select: { amount: true, source: true, reason: true },
    });

    expect(transaction).toMatchObject({
      amount: 40,
      source: XPSource.MESSAGE,
      reason: "integration test",
    });

    // The two copies of XP must not drift apart.
    const after = await prisma.guildMember.findUniqueOrThrow({
      where: { id: member.id },
      select: { xp: true },
    });

    expect(after.xp).toBe(40);
  });

  it("writes the MemberXP detail row as well", async () => {
    await awardXp({
      guildId: guild.id,
      memberId: member.id,
      amount: 100,
      source: XPSource.MESSAGE,
      reason: "integration test",
    });

    const detail = await prisma.memberXP.findFirst({
      where: { memberId: member.id },
      select: { totalXp: true, level: true },
    });

    expect(detail?.totalXp).toBe(100);
  });

  it("accumulates across several awards", async () => {
    for (let i = 0; i < 3; i += 1) {
      await awardXp({
        guildId: guild.id,
        memberId: member.id,
        amount: 10,
        source: XPSource.MESSAGE,
        reason: "integration test",
      });
    }

    const after = await prisma.guildMember.findUniqueOrThrow({
      where: { id: member.id },
      select: { xp: true },
    });

    expect(after.xp).toBe(30);
  });

  it("applies the daily cap", async () => {
    // The seeded guild has a cap; read it rather than assuming.
    const settings = await prisma.guild.findUniqueOrThrow({
      where: { id: guild.id },
      select: { xpDailyCap: true, xpMessageAmount: true },
    });

    if (settings.xpDailyCap <= 0) {
      // Nothing to assert when the cap is disabled.
      return;
    }

    const oversized = settings.xpDailyCap + 1000;

    const result = await awardXp({
      guildId: guild.id,
      memberId: member.id,
      amount: oversized,
      source: XPSource.MESSAGE,
      reason: "integration test",
    });

    expect(result.awarded).toBeLessThanOrEqual(settings.xpDailyCap);

    const after = await prisma.guildMember.findUniqueOrThrow({
      where: { id: member.id },
      select: { xp: true },
    });

    expect(after.xp).toBe(result.awarded);
  });

  it("ignores the cap when the caller asks it to", async () => {
    const settings = await prisma.guild.findUniqueOrThrow({
      where: { id: guild.id },
      select: { xpDailyCap: true },
    });

    if (settings.xpDailyCap <= 0) return;

    const oversized = settings.xpDailyCap + 500;

    const result = await awardXp({
      guildId: guild.id,
      memberId: member.id,
      amount: oversized,
      source: XPSource.REWARD,
      reason: "integration test",
      ignoreDailyCap: true,
    });

    expect(result.awarded).toBe(oversized);
  });

  it("keeps the member total equal to the sum of its transactions", async () => {
    for (const amount of [5, 15, 25]) {
      await awardXp({
        guildId: guild.id,
        memberId: member.id,
        amount,
        source: XPSource.MESSAGE,
        reason: "integration test",
      });
    }

    const transactions = await prisma.xPTransaction.aggregate({
      where: { memberId: member.id },
      _sum: { amount: true },
    });

    const memberRow = await prisma.guildMember.findUniqueOrThrow({
      where: { id: member.id },
      select: { xp: true },
    });

    expect(memberRow.xp).toBe(transactions._sum.amount);
  });

  it("reports a level change once the curve is crossed", async () => {
    const before = await prisma.guildMember.findUniqueOrThrow({
      where: { id: member.id },
      select: { level: true },
    });

    const result = await awardXp({
      guildId: guild.id,
      memberId: member.id,
      amount: 500,
      source: XPSource.MESSAGE,
      reason: "integration test",
      ignoreDailyCap: true,
    });

    const after = await prisma.guildMember.findUniqueOrThrow({
      where: { id: member.id },
      select: { level: true },
    });

    expect(result.leveledUp).toBe(after.level > before.level);
    expect(after.level).toBe(result.newLevel);
  });

  it("silently awards nothing to a member that does not exist", async () => {
    // Documented hazard, not endorsed behaviour.
    //
    // This is the exact failure shape that bit the challenge payout service in
    // an earlier phase: a Discord snowflake passed where a database member id
    // was expected, every query matched nothing, and nothing errored. Here the
    // same mistake produces `{awarded: 0}`, which reads like "the member was
    // already capped" rather than "you passed the wrong id".
    //
    // Asserting the real behaviour so a future change to throw is a visible,
    // deliberate difference rather than a silent one.
    const result = await awardXp({
      guildId: guild.id,
      memberId: "no-such-member-id",
      amount: 10,
      source: XPSource.MESSAGE,
    });

    expect(result.awarded).toBe(0);
    expect(result.totalXp).toBe(0);
  });

  it("writes no transaction for a member that does not exist", async () => {
    await awardXp({
      guildId: guild.id,
      memberId: "no-such-member-id",
      amount: 10,
      source: XPSource.MESSAGE,
    });

    // Nothing can have been written, since the member row is what the
    // transaction is keyed on.
    const transactions = await prisma.xPTransaction.count({
      where: { memberId: "no-such-member-id" },
    });

    expect(transactions).toBe(0);
  });
});