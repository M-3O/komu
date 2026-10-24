import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    guild: { findFirst: vi.fn() },
    guildMember: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { handleWarn } from "./moderate";

/**
 * A deferred interaction, as Discord sees it.
 *
 * `reply()` is deliberately made to throw once the interaction has been
 * deferred, which is what the real API does. Before the refusal helper was
 * added, `prepare()` called `reply()` on every failure path and the user saw
 * the generic "Something went wrong running that command." instead of the
 * reason.
 */
function deferredInteraction(overrides: Record<string, unknown> = {}) {
  const interaction = {
    deferred: false,
    replied: false,
    inGuild: () => true,
    guildId: "g1",
    guild: {
      members: {
        me: { id: "bot" },
        fetch: vi.fn().mockResolvedValue({ id: "u2", user: { username: "target" } }),
      },
    },
    memberPermissions: { has: () => true },
    user: { id: "moderator" },
    options: {
      getUser: () => ({ id: "u2", username: "target" }),
      getString: () => "smoke test",
    },
    deferReply: vi.fn(),
    reply: vi.fn(),
    editReply: vi.fn(),
  };

  interaction.deferReply.mockImplementation(async () => {
    interaction.deferred = true;
  });

  interaction.reply.mockImplementation(async () => {
    if (interaction.deferred || interaction.replied) {
      throw new Error("The reply to this interaction has already been sent or deferred.");
    }
  });

  interaction.editReply.mockImplementation(async () => undefined);

  return Object.assign(interaction, overrides);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("moderation refusals", () => {
  it("shows the no-record reason after deferring instead of throwing", async () => {
    prismaMock.guild.findFirst.mockResolvedValue({ id: "g1" });
    prismaMock.guildMember.findUnique.mockResolvedValue(null);

    const interaction = deferredInteraction();

    await handleWarn(interaction as never);

    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(interaction.reply).not.toHaveBeenCalled();

    const payload = interaction.editReply.mock.calls[0][0] as {
      embeds: { data: { description?: string } }[];
    };

    expect(payload.embeds[0].data.description).toContain("I have no record of target");
  });

  it("shows the permission reason instead of the generic failure", async () => {
    const interaction = deferredInteraction({
      memberPermissions: { has: () => false },
    });

    await handleWarn(interaction as never);

    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(interaction.reply).not.toHaveBeenCalled();

    const payload = interaction.editReply.mock.calls[0][0] as {
      embeds: { data: { description?: string } }[];
    };

    expect(payload.embeds[0].data.description).toContain("Administrator permission");
  });
});
