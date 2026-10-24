import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { checkGuildAccess } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";

/**
 * Who may administer the connected server (security review findings 1 and 2).
 *
 * The bug these cover is easy to reintroduce because it looks like a
 * reasonable guard: every dashboard action authenticated the caller, then
 * read the first guild in the table and discarded the user id it had just
 * fetched, so any signed-in account could rewrite the whole configuration.
 *
 * Two properties matter here and neither is obvious from reading the code.
 * The owner must be granted without a Discord call, because a settings save
 * should not wait on Discord and an outage must not lock out the person who
 * connected the server. Everyone else must be refused, including when Discord
 * cannot be reached: "we could not ask" is not permission.
 */

const SEED = randomUUID().slice(0, 8);

let ownerId: string;
let strangerId: string;
let unreachableId: string;
let guild: {
  id: string;
  name: string;
  discordId: string;
  ownerId: string | null;
};

beforeAll(async () => {
  ownerId = `integration-owner-${SEED}`;
  strangerId = `integration-stranger-${SEED}`;
  unreachableId = `integration-unreachable-${SEED}`;

  await prisma.user.createMany({
    data: [{ id: ownerId }, { id: strangerId }, { id: unreachableId }],
    skipDuplicates: true,
  });

  // A real Discord account, with a token, so the access check reaches the
  // network and can be made to fail there.
  await prisma.discordAccount.create({
    data: {
      userId: unreachableId,
      discordId: `integration-discord-${SEED}`,
      username: "Integration",
      accessToken: "integration-token",
    },
  });

  guild = await prisma.guild.create({
    data: {
      discordId: `integration-guild-${SEED}`,
      name: "Integration: authorisation",
      ownerId,
    },
    select: { id: true, name: true, discordId: true, ownerId: true },
  });
});

afterAll(async () => {
  await prisma.guild.deleteMany({ where: { id: guild.id } });
  await prisma.user.deleteMany({
    where: { id: { in: [ownerId, strangerId, unreachableId] } },
  });
});

describe("guild access", () => {
  it("grants the owner without asking Discord", async () => {
    // This user has no DiscordAccount at all, so a live check could only have
    // answered "denied". "granted" proves the local fast path answered.
    expect(await checkGuildAccess(ownerId, guild)).toBe("granted");
  });

  it("denies a signed-in user who does not administer the server", async () => {
    expect(await checkGuildAccess(strangerId, guild)).toBe("denied");
  });

  it("does not fall back to the first guild when no owner is recorded", async () => {
    expect(
      await checkGuildAccess(strangerId, {
        discordId: guild.discordId,
        ownerId: null,
      }),
    ).toBe("denied");
  });

  it("reports a Discord outage as unavailable, not as permission", async () => {
    const original = globalThis.fetch;

    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    try {
      expect(await checkGuildAccess(unreachableId, guild)).toBe("unavailable");
    } finally {
      globalThis.fetch = original;
    }
  });
});
