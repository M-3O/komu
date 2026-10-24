import { randomUUID } from "node:crypto";

import { ProgressionMetric, RewardActionType } from "@prisma/client";
import type { GuildMember } from "discord.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { grantEligibleRewards } from "./grant";

/**
 * The double-grant race (security review finding 3).
 *
 * Eligibility is decided from a snapshot, and the grant that records the
 * decision used to be written after the reward's actions ran. Two concurrent
 * evaluations therefore both saw "not granted" and both paid out: the member
 * received the XP twice, and a one-shot reward had two grant rows to prove it.
 */

const SEED = randomUUID().slice(0, 8);

let guildId: string;
let memberId: string;
let rewardId: string;
let discordMember: GuildMember;
let discordUserId: string;

beforeAll(async () => {
  discordUserId = `integration-reward-user-${SEED}`;

  const guild = await prisma.guild.create({
    data: {
      discordId: `integration-reward-guild-${SEED}`,
      name: "Integration: reward race",
    },
    select: { id: true },
  });

  guildId = guild.id;

  const member = await prisma.guildMember.create({
    data: { guildId, discordId: discordUserId, username: "Winner" },
    select: { id: true },
  });

  memberId = member.id;

  const reward = await prisma.reward.create({
    data: {
      guildId,
      name: "Race prize",
      description: "One grant only",
      conditionMetric: ProgressionMetric.MESSAGE_COUNT,
      conditionThreshold: 0,
      repeatable: false,
      actions: {
        create: { type: RewardActionType.GIVE_XP, xpAmount: 50 },
      },
    },
    select: { id: true },
  });

  rewardId = reward.id;

  // The reward only gives XP, so no Discord call is made and nothing reads
  // this object beyond its id. Casting avoids building a whole GuildMember.
  discordMember = { id: discordUserId } as GuildMember;
});

afterAll(async () => {
  // See the note in xp-races.integration.test.ts: an unset id makes Prisma
  // drop the where clause, which deletes every guild.
  if (!guildId) return;

  await prisma.guild.deleteMany({ where: { id: guildId } });
});

describe("reward grants", () => {
  it("rejects a duplicate one-shot claim", async () => {
    // Deterministic half: the unique key is what makes the end-to-end race
    // safe, and unlike the race it fails every time if the constraint is lost.
    const reward = await prisma.reward.create({
      data: {
        guildId,
        name: "Claim probe",
        conditionMetric: ProgressionMetric.MESSAGE_COUNT,
        conditionThreshold: 0,
        actions: { create: { type: RewardActionType.GIVE_XP, xpAmount: 1 } },
      },
      select: { id: true },
    });

    const claim = {
      guildId,
      rewardId: reward.id,
      memberId,
      progressValue: 1,
      dedupeKey: `${reward.id}:${memberId}`,
    };

    const first = await prisma.rewardGrant.createMany({ data: [claim] });
    const second = await prisma.rewardGrant.createMany({
      data: [claim],
      skipDuplicates: true,
    });

    expect(first.count).toBe(1);
    expect(second.count).toBe(0);
  });

  it("grants a one-shot reward once when two evaluations race", async () => {
    const [first, second] = await Promise.all([
      grantEligibleRewards({ member: discordMember, guildId }),
      grantEligibleRewards({ member: discordMember, guildId }),
    ]);

    // Two concurrent evaluations can interleave in either order, so assert on
    // the outcome rather than on which call won.
    expect(first.granted.length + second.granted.length).toBe(1);

    const [grants, member] = await Promise.all([
      prisma.rewardGrant.count({ where: { rewardId, memberId } }),
      prisma.guildMember.findUniqueOrThrow({
        where: { id: memberId },
        select: { xp: true },
      }),
    ]);

    // The unique claim key makes the second insert a no-op, so the actions
    // behind it never run.
    expect(grants).toBe(1);
    expect(member.xp).toBe(50);
  });
});
