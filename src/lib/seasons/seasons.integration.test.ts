import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "discord.js";
import { prisma } from "@/lib/db";
import * as xp from "@/lib/xp/award-xp";
import { recordStreamAttendance } from "@/lib/attendance/record-attendance";
import { recordStreamObservation, sendLiveAlert } from "@/lib/streams/alert-delivery";
import { processSeasonGrants } from "@/bot/services/season-grants";
import { manageSeason, manageSeasonGrants, manageSeasonSlot } from "@/app/dashboard/seasons/actions";
import { checkInToSeason, getMemberSeason } from "./check-in";
import { publishSeasonCheckIn } from "./posts";
import type { StreamInfo } from "@/lib/streams/types";

const mocks = vi.hoisted(() => ({
  sendChannelMessage: vi.fn(), addChannelMessageButton: vi.fn(), readChannelMessage: vi.fn(),
  findOwnAlertMessage: vi.fn(), inspectGuildRole: vi.fn(), guildHasRole: vi.fn(),
  requireGuild: vi.fn(), confirmSeasonStream: vi.fn(),
}));
vi.mock("@/lib/discord/rest", () => ({
  sendChannelMessage: mocks.sendChannelMessage, addChannelMessageButton: mocks.addChannelMessageButton,
  readChannelMessage: mocks.readChannelMessage, findOwnAlertMessage: mocks.findOwnAlertMessage,
  inspectGuildRole: mocks.inspectGuildRole, guildHasRole: mocks.guildHasRole,
}));
vi.mock("@/lib/dashboard/require-guild", () => ({ requireGuild: mocks.requireGuild }));
vi.mock("@/lib/seasons/pinned-streams", () => ({ confirmSeasonStream: mocks.confirmSeasonStream }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));

const roleId = "999000000000000111";
const channelId = "999000000000000112";
const actor = { discordUserId: "999000000000000115", username: "friday-member" };
let guild: { id: string; discordId: string; name: string };
let now: Date;
let streams: Array<{ accountId: string; info: StreamInfo; slotId: string }>;
let seasonId: string;

beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubEnv("KOMU_SEASONS_ENABLED", "true");
  now = new Date(Date.now() - 30_000);
  guild = await prisma.guild.create({ data: { discordId: "999000000000000110", name: "Private seasons test" } });
  const season = await prisma.season.create({
    data: { guildId: guild.id, name: "Friday Crew", timeZone: "UTC", goal: 2, roleId, status: "ACTIVE",
      activatedAt: new Date(+now - 60_000), endsAt: new Date(+now + 48 * 60 * 60_000) },
  });
  seasonId = season.id;
  streams = await Promise.all((["TWITCH", "YOUTUBE"] as const).map(async (provider, index) => {
    const account = await prisma.streamingAccount.create({
      data: { guildId: guild.id, provider, providerUserId: `season-account-${index}`, username: `season-${index}` },
    });
    await prisma.alertConfiguration.create({ data: { guildId: guild.id, streamingAccountId: account.id, channelId } });
    const slot = await prisma.seasonSlot.create({
      data: { seasonId, accountId: account.id, scheduledAt: now, videoId: index === 1 ? "abcdefghijk" : null },
    });
    return { slotId: slot.id, accountId: account.id, info: {
      provider, creatorId: account.providerUserId, creatorUsername: account.username, creatorDisplayName: null,
      providerStreamId: index === 1 ? "abcdefghijk" : "twitch-live", title: "Friday stream",
      url: "https://example.test/stream", game: null, thumbnail: null, viewerCount: null, startedAt: now,
    } };
  }));
  mocks.requireGuild.mockResolvedValue(guild);
  mocks.inspectGuildRole.mockResolvedValue(null);
  mocks.readChannelMessage.mockResolvedValue({ ok: true });
  mocks.addChannelMessageButton.mockResolvedValue({ ok: true });
  mocks.confirmSeasonStream.mockResolvedValue(streams[0].info);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  if (guild) {
    // Slots restrict removal of a configured account while the season exists.
    await prisma.season.deleteMany({ where: { guildId: guild.id } });
    await prisma.guild.deleteMany({ where: { id: guild.id } });
  }
});

function form(values: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

async function link(index: number) {
  const { accountId, info } = streams[index];
  const id = (await recordStreamObservation(accountId, info, new Date()))!;
  const messageId = `99900000000000012${index}`;
  mocks.sendChannelMessage.mockResolvedValueOnce({ ok: true, messageId });
  expect(await sendLiveAlert(accountId, id, info)).toBe("ALERTED");
  const binding = await prisma.seasonBroadcast.findUniqueOrThrow({ where: { streamId: id } });
  expect(binding.postMessageId).toBe(messageId);
  return { id, broadcastId: binding.id, messageId, guildDiscordId: guild.discordId, channelId, ...actor };
}

describe("Seasons on PostgreSQL", () => {
  it("binds once across simultaneous observations and keeps normal reactions and cross-platform check-ins idempotent", async () => {
    const first = streams[0];
    await Promise.all([1, 2].map(() => recordStreamObservation(first.accountId, first.info, new Date())));
    const kickOff = await link(0);
    expect(mocks.sendChannelMessage).toHaveBeenCalledWith(channelId, expect.objectContaining({
      components: expect.arrayContaining([expect.objectContaining({ components: [
        expect.objectContaining({ label: "Check in", custom_id: `komu:season:${kickOff.broadcastId}` }),
      ] })]),
    }));
    await recordStreamAttendance({ ...kickOff, alertMessageId: kickOff.messageId });
    const firstClicks = await Promise.all([checkInToSeason(kickOff), checkInToSeason(kickOff)]);
    expect(firstClicks.filter((row) => "credited" in row && row.credited)).toHaveLength(1);
    expect(firstClicks.every((row) => "count" in row && row.count === 1 && !row.newAttendance)).toBe(true);
    const second = await link(1);
    expect(await checkInToSeason(second)).toMatchObject({ count: 2, goal: 2, rewardStatus: "PENDING", newAttendance: true });
    expect(await recordStreamAttendance({ ...second, alertMessageId: second.messageId })).toMatchObject({ recorded: false });
    const member = await prisma.guildMember.findFirstOrThrow({ where: { guildId: guild.id, discordId: actor.discordUserId } });
    expect(member).toMatchObject({ xp: 50, streamAttendanceCount: 2 });
    expect(await prisma.seasonRoleGrant.count({ where: { seasonId } })).toBe(1);
    expect(await getMemberSeason(guild.discordId, actor.discordUserId)).toMatchObject({ count: 2, goal: 2 });
  });

  it("rolls back season credit, attendance and XP if the XP write fails", async () => {
    const input = await link(0);
    const original = xp.awardXp;
    const failed = vi.spyOn(xp, "awardXp").mockImplementationOnce(async (award, tx) => {
      await original(award, tx);
      throw new Error("simulated ledger failure");
    });
    try { await expect(checkInToSeason(input)).rejects.toThrow("simulated ledger failure"); }
    finally { failed.mockRestore(); }
    expect(await prisma.seasonCheckIn.count({ where: { slot: { seasonId } } })).toBe(0);
    expect(await prisma.streamAttendance.count({ where: { streamId: input.id } })).toBe(0);
    expect(await checkInToSeason(input)).toMatchObject({ count: 1, newAttendance: true });
  });

  it("rejects an unrelated post and closes after a confirmed end plus grace", async () => {
    const input = await link(0);
    expect(await checkInToSeason({ ...input, messageId: "not-the-alert" })).toHaveProperty("error");
    expect(await checkInToSeason({ ...input, guildDiscordId: "not-the-server" })).toHaveProperty("error");
    const endedAt = new Date();
    await recordStreamObservation(streams[0].accountId, null, endedAt, streams[0].info.providerStreamId);
    expect(await checkInToSeason({ ...input, now: new Date(+endedAt + 15 * 60_000) })).toHaveProperty("error");
    expect(await prisma.seasonRoleGrant.count({ where: { seasonId } })).toBe(0);
  });

  it("leaves out-of-window and wrong pinned videos alone, then matches the intended video", async () => {
    const { accountId, info } = streams[1];
    const other = await recordStreamObservation(accountId, { ...info, providerStreamId: "other-video" }, new Date());
    expect(await prisma.seasonBroadcast.findUnique({ where: { streamId: other! } })).toBeNull();
    const late = await recordStreamObservation(accountId, {
      ...info, providerStreamId: "late-video", startedAt: new Date(+now + 61 * 60_000),
    }, new Date(+now + 61 * 60_000));
    expect(await prisma.seasonBroadcast.findUnique({ where: { streamId: late! } })).toBeNull();
    // The independent Twitch slot is still eligible.
    expect((await link(0)).broadcastId).toBeTruthy();
  });

  it("keeps credit and closes the original message when replacing a slot", async () => {
    const first = await link(0);
    await checkInToSeason(first);
    const replacement = { ...streams[0].info, providerStreamId: "replacement", startedAt: new Date() };
    mocks.confirmSeasonStream.mockResolvedValue(replacement);
    const changed = await manageSeasonSlot({}, form({ slotId: streams[0].slotId, accountId: streams[0].accountId, intent: "attach" }));
    expect(changed).toHaveProperty("message");
    expect(await checkInToSeason(first)).toHaveProperty("error");
    const next = await prisma.seasonBroadcast.findFirstOrThrow({ where: { slotId: streams[0].slotId, supersededAt: null } });
    mocks.sendChannelMessage.mockResolvedValueOnce({ ok: true, messageId: "replacement-message" });
    expect(await publishSeasonCheckIn(guild.id, next.id)).toMatch(/Published/);
    expect(await checkInToSeason({ ...first, broadcastId: next.id, messageId: "replacement-message" }))
      .toMatchObject({ count: 1, credited: false, newAttendance: false });
  });

  it("publishes one no-ping fallback even with concurrent recovery requests", async () => {
    const { accountId, info } = streams[0];
    const streamId = (await recordStreamObservation(accountId, info, new Date()))!;
    const binding = await prisma.seasonBroadcast.findUniqueOrThrow({ where: { streamId } });
    mocks.sendChannelMessage.mockResolvedValue({ ok: true, messageId: "fallback-message" });
    await Promise.all([publishSeasonCheckIn(guild.id, binding.id), publishSeasonCheckIn(guild.id, binding.id)]);
    expect(mocks.sendChannelMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendChannelMessage).toHaveBeenCalledWith(channelId,
      expect.objectContaining({ allowedMentions: { parse: [] } }));
    expect(await checkInToSeason({ ...actor, broadcastId: binding.id, messageId: "fallback-message",
      channelId, guildDiscordId: guild.discordId })).toMatchObject({ count: 1 });
    mocks.sendChannelMessage.mockResolvedValueOnce({ ok: true, messageId: "late-alert" });
    expect(await sendLiveAlert(accountId, streamId, info)).toBe("ALERTED");
    const late = mocks.sendChannelMessage.mock.calls.at(-1)?.[1];
    expect(JSON.stringify(late.components)).not.toContain("Check in");
    expect(await checkInToSeason({ ...actor, broadcastId: binding.id, messageId: "late-alert",
      channelId, guildDiscordId: guild.discordId })).toHaveProperty("error");
  });

  it("recovers an ambiguous fallback without a second send", async () => {
    const { accountId, info } = streams[0];
    const streamId = (await recordStreamObservation(accountId, info, new Date()))!;
    const binding = await prisma.seasonBroadcast.findUniqueOrThrow({ where: { streamId } });
    mocks.sendChannelMessage.mockResolvedValue({ ok: false, code: "TIMEOUT" });
    expect(await publishSeasonCheckIn(guild.id, binding.id)).toMatch(/uncertain/);
    expect(await publishSeasonCheckIn(guild.id, binding.id)).toMatch(/could not be verified/);
    mocks.findOwnAlertMessage.mockResolvedValue({ id: "existing-recovery-post", postedAt: new Date() });
    expect(await publishSeasonCheckIn(guild.id, binding.id)).toMatch(/Recovered/);
    expect(mocks.sendChannelMessage).toHaveBeenCalledTimes(1);
    expect(await checkInToSeason({ ...actor, broadcastId: binding.id, messageId: "existing-recovery-post",
      channelId, guildDiscordId: guild.discordId })).toMatchObject({ count: 1 });
  });

  it("allows only one activation under contention", async () => {
    await prisma.season.update({ where: { id: seasonId }, data: { status: "CLOSED" } });
    const drafts = await Promise.all([1, 2].map((n) => prisma.season.create({
      data: { guildId: guild.id, name: `Draft ${n}`, timeZone: "UTC", goal: 2, roleId,
        endsAt: new Date(+now + 24 * 60 * 60_000),
        slots: { create: streams.map(({ accountId }) => ({ accountId, scheduledAt: new Date(+now + 120_000) })) } },
    })));
    const result = await Promise.all(drafts.map(({ id }) => manageSeason({}, form({ seasonId: id, intent: "activate" }))));
    expect(result.filter((row) => row.message)).toHaveLength(1);
    expect(await prisma.season.count({ where: { guildId: guild.id, status: "ACTIVE" } })).toBe(1);
  });

  it("resumes an expired role grant after a restart without re-adding an already held role", async () => {
    const first = await link(0);
    const second = await link(1);
    await checkInToSeason(first);
    const complete = await checkInToSeason(second);
    if (!("grantId" in complete) || !complete.grantId) throw new Error("Grant not queued");
    await prisma.seasonRoleGrant.update({ where: { id: complete.grantId },
      data: { claim: "old-worker", claimUntil: new Date(0) } });
    const add = vi.fn();
    const fake = { isReady: () => true, guilds: { cache: { get: () => ({
      members: { fetch: async () => ({ roles: { cache: new Set([roleId]), add } }) },
      roles: { fetch: async () => ({ id: roleId }) },
    }) } } } as unknown as Client;
    await processSeasonGrants(fake);
    expect(add).not.toHaveBeenCalled();
    expect(await prisma.seasonRoleGrant.findUnique({ where: { id: complete.grantId } })).toMatchObject({ status: "GRANTED" });
    expect(await manageSeasonGrants({}, form({ seasonId, grantId: complete.grantId, intent: "retry" }))).toHaveProperty("error");
  });

  it("preserves a blocked reward when the season closes and delivers it after an admin retries", async () => {
    const first = await link(0);
    const second = await link(1);
    await checkInToSeason(first);
    const result = await checkInToSeason(second);
    if (!("grantId" in result) || !result.grantId) throw new Error("Grant not queued");
    let canManage = false;
    const add = vi.fn().mockResolvedValue(undefined);
    const fake = { isReady: () => true, guilds: { cache: { get: () => ({
      id: guild.discordId,
      members: { fetch: async () => ({ roles: { cache: new Set(), add } }),
        fetchMe: async () => ({ permissions: { has: () => canManage },
          roles: { highest: { comparePositionTo: () => 1 } } }) },
      roles: { fetch: async () => ({ id: roleId }) },
    }) } } } as unknown as Client;
    await processSeasonGrants(fake);
    expect(await prisma.seasonRoleGrant.findUnique({ where: { id: result.grantId } }))
      .toMatchObject({ status: "BLOCKED", reason: "ROLE_PERMISSIONS" });
    expect(await manageSeason({}, form({ seasonId, intent: "close" }))).toHaveProperty("message");
    expect(await checkInToSeason(second)).toHaveProperty("error");
    canManage = true;
    expect(await manageSeasonGrants({}, form({ seasonId, grantId: result.grantId, intent: "retry" }))).toHaveProperty("message");
    await processSeasonGrants(fake);
    expect(add).toHaveBeenCalledExactlyOnceWith(roleId);
    expect(await prisma.seasonRoleGrant.findUnique({ where: { id: result.grantId } })).toMatchObject({ status: "GRANTED" });
  });
});
