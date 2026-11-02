import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireGuild,
  create,
  findFirst,
  update,
  listGuildChannels,
  listGuildRoles,
  refresh,
} = vi.hoisted(() => ({
  requireGuild: vi.fn(),
  create: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  listGuildChannels: vi.fn(),
  listGuildRoles: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/dashboard/require-guild", () => ({ requireGuild }));
vi.mock("@/lib/db", () => ({
  prisma: {
    challenge: { create, findFirst, update },
  },
}));
vi.mock("@/lib/discord/rest", () => ({
  isTextChannelType: (type: number) => [0, 5, 10, 11, 12].includes(type),
  listGuildChannels,
  listGuildRoles,
}));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("next/cache", () => ({ refresh }));

import {
  createChallengeAction,
  updateChallengeAnnouncementAction,
} from "./actions";

const GUILD = {
  id: "guild-db",
  discordId: "guild-discord",
  name: "M3K",
};

const CHANNELS = [
  { id: "channel-main", name: "announcements", type: 0, position: 1 },
  { id: "channel-news", name: "news", type: 5, position: 2 },
  { id: "channel-voice", name: "voice", type: 2, position: 3 },
];

const FORM = {
  name: "Community Starter",
  description: "Start participating in the community.",
  endsAt: "",
  xpReward: "250",
  roleId: "",
  announcementChannelId: "channel-main",
  type: "MESSAGE_COUNT",
  threshold: "3",
  label: "",
};

function formData(overrides: Partial<typeof FORM> = {}): FormData {
  const data = new FormData();
  const values = { ...FORM, ...overrides };

  for (const [key, value] of Object.entries(values)) {
    data.set(key, value);
  }

  return data;
}

beforeEach(() => {
  requireGuild.mockReset().mockResolvedValue(GUILD);
  create.mockReset().mockResolvedValue({ id: "challenge-1" });
  findFirst.mockReset();
  update.mockReset().mockResolvedValue({});
  listGuildChannels.mockReset().mockResolvedValue(CHANNELS);
  listGuildRoles.mockReset();
  refresh.mockReset();
});

describe("challenge announcement channel actions", () => {
  it("saves a selected text channel when creating a challenge", async () => {
    await expect(createChallengeAction({}, formData())).resolves.toEqual({
      ok: true,
    });

    expect(listGuildChannels).toHaveBeenCalledWith("guild-discord");
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        guildId: "guild-db",
        name: "Community Starter",
        announcementChannelId: "channel-main",
      }),
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("edits an existing challenge without recreating it", async () => {
    findFirst.mockResolvedValueOnce({ id: "challenge-1" });

    await expect(
      updateChallengeAnnouncementAction(
        "challenge-1",
        {},
        formData({ announcementChannelId: "channel-news" }),
      ),
    ).resolves.toEqual({ ok: true });

    expect(update).toHaveBeenCalledWith({
      where: { id: "challenge-1" },
      data: { announcementChannelId: "channel-news" },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("clears the saved channel with the No announcement option", async () => {
    findFirst.mockResolvedValueOnce({ id: "challenge-1" });

    await expect(
      updateChallengeAnnouncementAction(
        "challenge-1",
        {},
        formData({ announcementChannelId: "" }),
      ),
    ).resolves.toEqual({ ok: true });

    expect(listGuildChannels).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: "challenge-1" },
      data: { announcementChannelId: null },
    });
  });

  it("rejects a channel that is not a text destination", async () => {
    findFirst.mockResolvedValueOnce({ id: "challenge-1" });

    await expect(
      updateChallengeAnnouncementAction(
        "challenge-1",
        {},
        formData({ announcementChannelId: "channel-voice" }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: "Choose a text channel for challenge announcements.",
    });

    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a channel from another guild", async () => {
    findFirst.mockResolvedValueOnce({ id: "challenge-1" });

    await expect(
      updateChallengeAnnouncementAction(
        "challenge-1",
        {},
        formData({ announcementChannelId: "channel-from-another-guild" }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("unavailable in this server"),
    });

    expect(listGuildChannels).toHaveBeenCalledWith("guild-discord");
    expect(update).not.toHaveBeenCalled();
  });

  it("returns a recoverable error when Discord channels cannot be loaded", async () => {
    findFirst.mockResolvedValueOnce({ id: "challenge-1" });
    listGuildChannels.mockResolvedValueOnce([]);

    await expect(
      updateChallengeAnnouncementAction(
        "challenge-1",
        {},
        formData({ announcementChannelId: "channel-main" }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("could not be loaded"),
    });

    expect(update).not.toHaveBeenCalled();
  });
});