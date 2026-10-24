import { randomUUID } from "node:crypto";

import { XPSource } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { awardXp } from "./award-xp";
import { handleMessageActivity } from "./message-xp";

/**
 * Two races in the XP path (security review findings 4 and 5).
 *
 * Both are invisible to a single-threaded test: the code reads, computes and
 * writes in the right order, and only interleaving produces the wrong answer.
 * Both also fail quietly. The lost update leaves the cached total and the
 * transaction history disagreeing with no error raised, and the cooldown
 * bypass simply pays a burst of messages at several times the intended rate.
 */

const SEED = randomUUID().slice(0, 8);

let guildId: string;
let guildDiscordId: string;
let discordUserId: string;
let memberId: string;

beforeAll(async () => {
  guildDiscordId = `integration-xp-guild-${SEED}`;
  discordUserId = `integration-xp-user-${SEED}`;

  const guild = await prisma.guild.create({
    data: {
      discordId: guildDiscordId,
      name: "Integration: XP races",
      xpEnabled: true,
      xpMessageAmount: 15,
      xpMessageMinLength: 1,
      xpMessageCooldownSecs: 60,
      // Zero means no cap, so a failure here is never the cap's doing.
      xpDailyCap: 0,
    },
    select: { id: true },
  });

  guildId = guild.id;

  const member = await prisma.guildMember.create({
    data: { guildId, discordId: discordUserId, username: "Racer" },
    select: { id: true },
  });

  memberId = member.id;
});

afterAll(async () => {
  // `deleteMany({ where: { id: undefined } })` drops the filter and deletes
  // every guild. `guildId` is unset when `beforeAll` failed (a cold database
  // is enough), and Vitest runs `afterAll` anyway, so this guard is the
  // difference between cleaning up one test guild and wiping the database.
  if (!guildId) return;

  // Cascades to members, transactions and reward grants.
  await prisma.guild.deleteMany({ where: { id: guildId } });
});

describe("XP races", () => {
  it("keeps the cached total equal to the transaction history", async () => {
    const amounts = [10, 15, 5];

    await Promise.all(
      amounts.map((amount) =>
        awardXp({
          guildId,
          memberId,
          amount,
          source: XPSource.MANUAL,
          ignoreDailyCap: true,
        }),
      ),
    );

    const [member, history] = await Promise.all([
      prisma.guildMember.findUniqueOrThrow({
        where: { id: memberId },
        select: { xp: true },
      }),
      prisma.xPTransaction.aggregate({
        where: { memberId },
        _sum: { amount: true },
      }),
    ]);

    // Before the row lock both awards read the same total, so both wrote the
    // same result while both inserted a transaction row. The two numbers below
    // are what drifted apart.
    expect(member.xp).toBe(30);
    expect(history._sum.amount).toBe(30);
  });

  it("awards one message per cooldown window under concurrency", async () => {
    const before = await prisma.xPTransaction.count({
      where: { memberId, source: XPSource.MESSAGE },
    });

    await Promise.all([
      handleMessageActivity({
        guildId,
        guildDiscordId,
        discordUserId,
        username: "Racer",
        message: "the first of two messages arriving together",
      }),
      handleMessageActivity({
        guildId,
        guildDiscordId,
        discordUserId,
        username: "Racer",
        message: "the second one, with different text so repeats do not apply",
      }),
    ]);

    const after = await prisma.xPTransaction.count({
      where: { memberId, source: XPSource.MESSAGE },
    });

    // Both calls read lastXpMessageAt from before either had written it, so
    // without the conditional claim both awarded.
    expect(after - before).toBe(1);
  });
});
