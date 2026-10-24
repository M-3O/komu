import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getSetupChecklist } from "@/lib/dashboard/setup-checklist";
import { prisma } from "@/lib/db";
import { fakeDiscordId, requireGuild } from "@/test/integration-helpers";

// The checklist now enforces its own auth boundary, like every other data
// function. These tests exercise the database query, not the session, so the
// boundary is satisfied with a fixed user.
vi.mock("@/lib/auth/current-user", () => ({
  requireCurrentUser: vi.fn(async () => ({
    userId: "integration-test",
    discordId: "0",
    username: "integration-test",
    avatarUrl: null,
  })),
}));

/**
 * The checklist must only report what is actually working.
 *
 * A step that reads "done" when nothing will happen is worse than a missing
 * step: the creator stops looking and never configures the thing. That is not
 * hypothetical — alert settings belong to a streaming account, and disconnecting
 * an account leaves its settings behind. The checklist has to ignore them, the
 * same way the polling cycle does.
 *
 * Every assertion is relative to the guild's existing state, so the suite is
 * safe to run against a development database that already has real accounts.
 */

const CONNECTED_USER_ID = "checklist-connected-800020";
const DISCONNECTED_USER_ID = "checklist-disconnected-800021";

const CHANNEL_ID = fakeDiscordId(800022);
const ROLE_ID = fakeDiscordId(800023);

let guild: { id: string };

beforeEach(async () => {
  guild = await requireGuild();
  await removeTestAccounts();
});

afterEach(async () => {
  await removeTestAccounts();
});

/**
 * Create a streaming account, optionally disconnected.
 *
 * Alert settings are nested so the account and its configuration are written
 * together, which is the state the checklist reads.
 */
async function createAccount(providerUserId: string, disconnected: boolean) {
  return prisma.streamingAccount.create({
    data: {
      guildId: guild.id,
      provider: "TWITCH",
      providerUserId,
      username: providerUserId,
      disconnectedAt: disconnected ? new Date() : null,
      alertConfig: {
        create: {
          guildId: guild.id,
          enabled: true,
          channelId: CHANNEL_ID,
          mentionRoleId: ROLE_ID,
          mentionEnabled: true,
        },
      },
    },
    select: { id: true },
  });
}

async function removeTestAccounts() {
  await prisma.streamingAccount.deleteMany({
    where: { providerUserId: { in: [CONNECTED_USER_ID, DISCONNECTED_USER_ID] } },
  });
}

function step(checklist: Awaited<ReturnType<typeof getSetupChecklist>>, id: string) {
  const found = checklist.steps.find((entry) => entry.id === id);

  if (!found) throw new Error(`No ${id} step in the checklist`);

  return found;
}

describe("setup checklist alert steps", () => {
  it("ignores the settings of a disconnected account", async () => {
    const before = await getSetupChecklist();

    await createAccount(DISCONNECTED_USER_ID, true);

    const after = await getSetupChecklist();

    // Nothing about the installation changed: the account is gone as far as
    // both the checklist and the polling cycle are concerned.
    expect(after.steps).toEqual(before.steps);
    expect(after.completed).toBe(before.completed);
  });

  it("counts a connected account with alerts configured", async () => {
    await createAccount(CONNECTED_USER_ID, false);

    const checklist = await getSetupChecklist();

    expect(step(checklist, "alert-channel").done).toBe(true);
    expect(step(checklist, "alert-role").done).toBe(true);
    expect(step(checklist, "account").done).toBe(true);
  });

  it("stops counting alerts once they are turned off", async () => {
    // The guild may already have a working alert, so the baseline is read
    // rather than assumed. What matters is that this account stops counting.
    const before = await getSetupChecklist();
    const readyWithoutThisAccount = step(before, "alert-channel").done;

    const account = await createAccount(CONNECTED_USER_ID, false);

    // This account alone is enough to satisfy the step.
    expect(step(await getSetupChecklist(), "alert-channel").done).toBe(true);

    await prisma.alertConfiguration.update({
      where: { streamingAccountId: account.id },
      data: { enabled: false },
    });

    const after = await getSetupChecklist();

    expect(step(after, "alert-channel").done).toBe(readyWithoutThisAccount);
    // The account step is separate and should be unaffected.
    expect(step(after, "account").done).toBe(true);
  });
});