import { MessagePayload, type GuildMember, type TextChannel } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirst, findMany, updateMany } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    guildMember: { findFirst },
    challengeProgress: { findMany, updateMany },
  },
}));

import {
  announceChallengeCompletions,
  buildChallengeCompletionAnnouncement,
} from "./announce-completion";

/**
 * Challenge completion announcements.
 *
 * The important cases are the ones that cannot be checked from the dashboard:
 * a failed send must remain retryable, a missing channel must not throw, and
 * two progression passes must not both post the same completion.
 */

const GUILD_ID = "guild-db-1";
const NOW = new Date("2026-10-29T12:00:00.000Z");

const challenge = {
  name: "Stream Season",
  xpReward: 250,
  rewardRoleName: "Challenge Winner",
  announcementChannelId: "channel-1",
};

function progressRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "progress-1",
    challenge: { ...challenge, ...overrides },
  };
}

function discordMember() {
  const send = vi.fn().mockResolvedValue({ id: "message-1" });
  const fetch = vi.fn().mockResolvedValue({
    id: "channel-1",
    isTextBased: () => true,
    send,
  });

  const member = {
    id: "discord-user-1",
    guild: { channels: { fetch } },
  } as unknown as GuildMember;

  return { member, send, fetch };
}

beforeEach(() => {
  findFirst.mockReset();
  findMany.mockReset();
  updateMany.mockReset();

  findFirst.mockResolvedValue({ id: "member-db-1" });
});

describe("buildChallengeCompletionAnnouncement", () => {
  it("includes the member, challenge name, status and available reward", () => {
    const message = buildChallengeCompletionAnnouncement(
      { id: "discord-user-1" },
      challenge,
    );
    const embed = message.embeds[0].data;

    expect(message.content).toContain("<@discord-user-1>");
    expect(message.content).toContain("Stream Season");
    expect(embed.title).toBe("Challenge complete");
    expect(embed.description).toContain("Stream Season");
    expect(embed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Status", value: "Completed" }),
        expect.objectContaining({
          name: "Reward",
          value: expect.stringContaining("250 XP"),
        }),
        expect.objectContaining({
          name: "Reward",
          value: expect.stringContaining("@Challenge Winner"),
        }),
      ]),
    );
    expect(message.allowedMentions).toEqual({
      parse: [],
      users: ["discord-user-1"],
    });
  });

  it.each([
    "@everyone",
    "@here",
    "<@&222222222222222222>",
    "<@333333333333333333>",
    "<@!333333333333333333>",
  ])("allows only the completed member when the challenge name contains %s", (mention) => {
    const memberId = "111111111111111111";
    const message = buildChallengeCompletionAnnouncement(
      { id: memberId },
      { ...challenge, name: `Challenge ${mention}` },
    );
    // Serialize through the installed Discord.js implementation without a
    // client login or HTTP request. Per-message restrictions must also win
    // over a client's permissive defaults.
    const channel = {
      client: {
        options: { allowedMentions: { parse: ["users", "roles", "everyone"] } },
      },
    } as unknown as TextChannel;
    const body = new MessagePayload(channel, message).resolveBody().body;

    expect(body).toHaveProperty("content", `<@${memberId}> completed **Challenge ${mention}**!`);
    expect(body).toHaveProperty("allowed_mentions", { parse: [], users: [memberId] });
  });

  it("omits the reward field when the challenge has no reward", () => {
    const message = buildChallengeCompletionAnnouncement(
      { id: "discord-user-1" },
      { ...challenge, xpReward: 0, rewardRoleName: null },
    );

    expect(message.embeds[0].data.fields).toEqual([
      expect.objectContaining({ name: "Status" }),
    ]);
  });
});

describe("announceChallengeCompletions", () => {
  it("posts a completed challenge and records delivery only after the send", async () => {
    const { member, send, fetch } = discordMember();
    findMany.mockResolvedValue([progressRow()]);
    updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });

    const result = await announceChallengeCompletions({
      member,
      guildId: GUILD_ID,
      now: NOW,
    });

    expect(result.announced).toEqual([
      { challenge: "Stream Season", messageId: "message-1" },
    ]);
    expect(result.failed).toEqual([]);
    expect(fetch).toHaveBeenCalledWith("channel-1");
    expect(send).toHaveBeenCalledTimes(1);

    const message = send.mock.calls[0][0];
    expect(message.content).toContain("Stream Season");
    expect(message.embeds[0].data.title).toBe("Challenge complete");
    expect(message.allowedMentions).toEqual({ parse: [], users: [member.id] });

    const claim = updateMany.mock.calls[0][0];
    const claimToken = claim.data.announcementClaimToken;
    expect(claim).toMatchObject({
      where: expect.objectContaining({
        id: "progress-1",
        announcementSentAt: null,
      }),
      data: {
        announcementClaimedAt: NOW,
        announcementClaimToken: expect.any(String),
      },
    });
    expect(claimToken).toEqual(expect.any(String));
    expect(updateMany.mock.calls[1][0]).toMatchObject({
      where: {
        id: "progress-1",
        announcementSentAt: null,
        announcementClaimToken: claimToken,
      },
      data: {
        announcementSentAt: NOW,
        announcementClaimedAt: null,
        announcementClaimToken: null,
      },
    });
  });

  it("does not record delivery until Discord accepts the message", async () => {
    const { member, send } = discordMember();
    let acceptSend: (message: { id: string }) => void = () => {};

    send.mockImplementation(
      () =>
        new Promise<{ id: string }>((resolve) => {
          acceptSend = resolve;
        }),
    );
    findMany.mockResolvedValue([progressRow()]);
    updateMany.mockResolvedValue({ count: 1 });

    const pending = announceChallengeCompletions({
      member,
      guildId: GUILD_ID,
      now: NOW,
    });

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(updateMany).toHaveBeenCalledTimes(1); // The claim, not delivery.

    acceptSend({ id: "message-1" });
    const result = await pending;

    expect(result.announced).toHaveLength(1);
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany.mock.calls[1][0]).toMatchObject({
      where: {
        announcementClaimToken:
          updateMany.mock.calls[0][0].data.announcementClaimToken,
      },
      data: {
        announcementSentAt: NOW,
        announcementClaimedAt: null,
        announcementClaimToken: null,
      },
    });
  });

  it("does not post the same completion twice", async () => {
    const { member, send } = discordMember();
    findMany.mockResolvedValue([progressRow()]);

    let claimed = false;
    let sent = false;

    updateMany.mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      if ("announcementSentAt" in data) {
        sent = true;
        claimed = false;
        return Promise.resolve({ count: 1 });
      }

      if (data.announcementClaimedAt === null) {
        claimed = false;
        return Promise.resolve({ count: 1 });
      }

      if (sent || claimed) return Promise.resolve({ count: 0 });

      claimed = true;
      return Promise.resolve({ count: 1 });
    });

    const first = await announceChallengeCompletions({
      member,
      guildId: GUILD_ID,
      now: NOW,
    });
    const second = await announceChallengeCompletions({
      member,
      guildId: GUILD_ID,
      now: NOW,
    });

    expect(first.announced).toHaveLength(1);
    expect(second.announced).toHaveLength(0);
    expect(second.skippedDuplicate).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the challenge has no announcement channel", async () => {
    const { member, send, fetch } = discordMember();
    findMany.mockResolvedValue([
      progressRow({ announcementChannelId: null }),
    ]);

    const result = await announceChallengeCompletions({
      member,
      guildId: GUILD_ID,
      now: NOW,
    });

    expect(result.skippedNoChannel).toBe(1);
    expect(result.announced).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("leaves delivery unrecorded when Discord rejects the message", async () => {
    const { member, send } = discordMember();
    send.mockRejectedValue(new Error("Missing Permissions"));
    findMany.mockResolvedValue([progressRow()]);
    updateMany.mockResolvedValue({ count: 1 });

    const result = await announceChallengeCompletions({
      member,
      guildId: GUILD_ID,
      now: NOW,
    });

    expect(result.failed).toEqual([
      { challenge: "Stream Season", reason: "Missing Permissions" },
    ]);
    expect(result.announced).toEqual([]);
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany.mock.calls[1][0]).toMatchObject({
      where: {
        id: "progress-1",
        announcementSentAt: null,
        announcementClaimToken:
          updateMany.mock.calls[0][0].data.announcementClaimToken,
      },
      data: {
        announcementClaimedAt: null,
        announcementClaimToken: null,
      },
    });
    expect(
      updateMany.mock.calls.some(([call]) =>
        Object.hasOwn(call.data as object, "announcementSentAt"),
      ),
    ).toBe(false);
  });

  it("leaves delivery unrecorded when the channel has been removed", async () => {
    const { member, fetch } = discordMember();
    fetch.mockRejectedValue(new Error("Unknown Channel"));
    findMany.mockResolvedValue([progressRow()]);
    updateMany.mockResolvedValue({ count: 1 });

    const result = await announceChallengeCompletions({
      member,
      guildId: GUILD_ID,
      now: NOW,
    });

    expect(result.failed).toEqual([
      { challenge: "Stream Season", reason: "Unknown Channel" },
    ]);
    expect(result.announced).toEqual([]);
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany.mock.calls[1][0]).toMatchObject({
      where: {
        id: "progress-1",
        announcementSentAt: null,
        announcementClaimToken:
          updateMany.mock.calls[0][0].data.announcementClaimToken,
      },
      data: {
        announcementClaimedAt: null,
        announcementClaimToken: null,
      },
    });
  });

  it("retries the final delivery mark after a transient database failure", async () => {
    const { member, send } = discordMember();
    findMany.mockResolvedValue([progressRow()]);
    updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error("temporary database failure"))
      .mockResolvedValueOnce({ count: 1 });

    const result = await announceChallengeCompletions({
      member,
      guildId: GUILD_ID,
      now: NOW,
    });

    expect(result.announced).toEqual([
      { challenge: "Stream Season", messageId: "message-1" },
    ]);
    expect(result.failed).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledTimes(3);
    expect(updateMany.mock.calls[2][0]).toMatchObject({
      where: {
        announcementClaimToken:
          updateMany.mock.calls[0][0].data.announcementClaimToken,
      },
      data: { announcementSentAt: NOW },
    });
  });

  it("stops after the bounded final-mark retries and leaves the claim intact", async () => {
    const { member, send } = discordMember();
    findMany.mockResolvedValue([progressRow()]);
    updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValue(new Error("database unavailable"));

    const result = await announceChallengeCompletions({
      member,
      guildId: GUILD_ID,
      now: NOW,
    });

    expect(result.announced).toEqual([]);
    expect(result.failed).toEqual([
      { challenge: "Stream Season", reason: "database unavailable" },
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledTimes(4);

    const releaseCalls = updateMany.mock.calls
      .slice(1)
      .filter(([call]) => !Object.hasOwn(call.data as object, "announcementSentAt"));
    expect(releaseCalls).toEqual([]);
  });

  it("returns an announcement failure instead of throwing when the progress query fails", async () => {
    const { member, send } = discordMember();
    findMany.mockRejectedValue(new Error("database unavailable"));

    const result = await announceChallengeCompletions({
      member,
      guildId: GUILD_ID,
      now: NOW,
    });

    expect(result.announced).toEqual([]);
    expect(result.failed).toEqual([
      { challenge: "announcement check", reason: "database unavailable" },
    ]);
    expect(send).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("does not let a stale claimant release a newer claim", async () => {
    const pendingSends: Array<{
      resolve: (message: { id: string }) => void;
      reject: (reason?: unknown) => void;
    }> = [];

    const send = vi.fn(
      () =>
        new Promise<{ id: string }>((resolve, reject) => {
          pendingSends.push({ resolve, reject });
        }),
    );
    const fetch = vi.fn().mockResolvedValue({
      id: "channel-1",
      isTextBased: () => true,
      send,
    });
    const member = {
      id: "discord-user-1",
      guild: { channels: { fetch } },
    } as unknown as GuildMember;

    findMany.mockResolvedValue([progressRow()]);

    let currentToken: string | null = null;
    let currentClaimedAt: Date | null = null;
    let sent = false;

    updateMany.mockImplementation(
      (args: {
        where: {
          announcementClaimToken?: string;
          OR?: Array<{
            announcementClaimedAt?: null | { lt?: Date };
          }>;
        };
        data: Record<string, unknown>;
      }) => {
        const { where, data } = args;

        if ("announcementSentAt" in data) {
          if (sent || currentToken !== where.announcementClaimToken) {
            return Promise.resolve({ count: 0 });
          }

          sent = true;
          currentToken = null;
          currentClaimedAt = null;
          return Promise.resolve({ count: 1 });
        }

        if (
          data.announcementClaimedAt === null &&
          data.announcementClaimToken === null
        ) {
          if (sent || currentToken !== where.announcementClaimToken) {
            return Promise.resolve({ count: 0 });
          }

          currentToken = null;
          currentClaimedAt = null;
          return Promise.resolve({ count: 1 });
        }

        const staleBefore = where.OR?.find(
          (entry) =>
            entry.announcementClaimedAt !== null &&
            typeof entry.announcementClaimedAt === "object" &&
            entry.announcementClaimedAt.lt instanceof Date,
        )?.announcementClaimedAt?.lt;

        if (
          sent ||
          (currentToken !== null &&
            (!currentClaimedAt ||
              !staleBefore ||
              currentClaimedAt >= staleBefore))
        ) {
          return Promise.resolve({ count: 0 });
        }

        currentToken = data.announcementClaimToken as string;
        currentClaimedAt = data.announcementClaimedAt as Date;
        return Promise.resolve({ count: 1 });
      },
    );

    const first = announceChallengeCompletions({
      member,
      guildId: GUILD_ID,
      now: NOW,
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));

    const second = announceChallengeCompletions({
      member,
      guildId: GUILD_ID,
      now: new Date(NOW.getTime() + 6 * 60 * 1000),
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));

    const firstClaimToken =
      updateMany.mock.calls[0][0].data.announcementClaimToken;

    pendingSends[0].reject(new Error("Missing Permissions"));
    const firstResult = await first;

    pendingSends[1].resolve({ id: "message-2" });
    const secondResult = await second;

    expect(firstResult.announced).toEqual([]);
    expect(firstResult.failed).toEqual([
      { challenge: "Stream Season", reason: "Missing Permissions" },
    ]);
    expect(secondResult.announced).toEqual([
      { challenge: "Stream Season", messageId: "message-2" },
    ]);
    expect(secondResult.failed).toEqual([]);
    expect(send).toHaveBeenCalledTimes(2);

    const release = updateMany.mock.calls.find(
      ([call]) =>
        call.data.announcementClaimedAt === null &&
        !Object.hasOwn(call.data as object, "announcementSentAt"),
    );
    expect(release?.[0].where.announcementClaimToken).toBe(firstClaimToken);
  });
});
