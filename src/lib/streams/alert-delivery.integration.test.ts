import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { requireGuild } from "@/test/integration-helpers";
import { markStaleAlertClaims, reconcileLiveAlert, recordStreamObservation, sendLiveAlert } from "./alert-delivery";
import type { StreamInfo } from "./types";
import { reserveYouTubeSearch } from "@/lib/youtube/search-budget";

const discord = vi.hoisted(() => ({ sendChannelMessage: vi.fn(), findOwnAlertMessage: vi.fn() }));
vi.mock("@/lib/discord/rest", () => discord);

let accountId: string;
let guildId: string;
let stream: StreamInfo;
const channelId = "999000000000000034";
const referenceMessage = "999000000000000035";
const updateConfig = (data: { enabled?: boolean; channelId?: string }) =>
  prisma.alertConfiguration.update({ where: { streamingAccountId: accountId }, data });
const readDelivery = (streamId: string) => prisma.streamAlertDelivery.findUniqueOrThrow({ where: { streamId } });

beforeEach(async () => {
  vi.resetAllMocks();
  guildId = (await requireGuild()).id;
  const account = await prisma.streamingAccount.create({
    data: { guildId, provider: "TWITCH", providerUserId: crypto.randomUUID(), username: "integration" },
  });
  accountId = account.id;
  await prisma.alertConfiguration.create({ data: { guildId, streamingAccountId: accountId, channelId } });
  stream = {
    provider: "TWITCH", providerStreamId: "test-live", creatorId: account.providerUserId,
    creatorUsername: account.username, creatorDisplayName: null, startedAt: new Date(),
    title: "Integration test", game: null, thumbnail: null, viewerCount: null,
    url: "https://www.twitch.tv/integration",
  };
  discord.sendChannelMessage.mockResolvedValue({ ok: true, messageId: referenceMessage });
});

afterEach(async () => {
  if (accountId) await prisma.streamingAccount.deleteMany({ where: { id: accountId } });
});

describe("durable stream delivery", () => {
  it("tracks disabled sessions and sends only after an explicit request", async () => {
    await updateConfig({ enabled: false });
    const id = (await recordStreamObservation(accountId, stream, new Date()))!;
    expect(await readDelivery(id)).toMatchObject({ status: "SKIPPED", reason: "ALERTS_OFF" });
    await updateConfig({ enabled: true });
    await sendLiveAlert(accountId, id, stream);
    expect(discord.sendChannelMessage).not.toHaveBeenCalled();
    expect(await sendLiveAlert(accountId, id, stream, true, { channelId, roleId: null })).toBe("ALERTED");
  });

  it("claims one send across concurrent observations and callers", async () => {
    const ids = await Promise.all([1, 2].map(() => recordStreamObservation(accountId, stream, new Date())));
    expect(ids[0]).toBe(ids[1]);
    await Promise.all(ids.map((id) => sendLiveAlert(accountId, id!, stream)));
    expect(discord.sendChannelMessage).toHaveBeenCalledTimes(1);
    expect(await readDelivery(ids[0]!)).toMatchObject({ status: "SENT" });
  });

  it("requires a deliberate send when the destination changes", async () => {
    const id = (await recordStreamObservation(accountId, stream, new Date()))!;
    await updateConfig({ channelId: "999000000000000099" });
    await sendLiveAlert(accountId, id, stream);
    expect(await readDelivery(id)).toMatchObject({ status: "BLOCKED", reason: "AUDIENCE_CHANGED" });
    expect(discord.sendChannelMessage).not.toHaveBeenCalled();
  });

  it("allows a live retry after a definite permission rejection", async () => {
    discord.sendChannelMessage.mockResolvedValueOnce({ ok: false, status: 403, code: "DISCORD_50013" });
    const id = (await recordStreamObservation(accountId, stream, new Date()))!;
    await sendLiveAlert(accountId, id, stream);
    expect(await readDelivery(id)).toMatchObject({ status: "BLOCKED", reason: "DISCORD_50013" });
    await sendLiveAlert(accountId, id, stream);
    expect(discord.sendChannelMessage).toHaveBeenCalledTimes(1);
    expect(await sendLiveAlert(accountId, id, stream, true, { channelId, roleId: null })).toBe("ALERTED");
  });

  it("ignores delayed starts and end observations for a previous broadcast", async () => {
    const oldTime = new Date(Date.now() - 30_000);
    const older = { ...stream, startedAt: oldTime };
    const oldId = (await recordStreamObservation(accountId, older, oldTime))!;
    const current = { ...stream, providerStreamId: "next" };
    const newId = (await recordStreamObservation(accountId, current, new Date()))!;
    expect(await readDelivery(oldId)).toMatchObject({ status: "EXPIRED" });
    expect(await recordStreamObservation(accountId, older, new Date())).toBeNull();
    await recordStreamObservation(accountId, null, new Date(), older.providerStreamId);
    expect(await readDelivery(newId)).toMatchObject({ status: "PENDING" });
  });

  it("caps automatic rate-limit retries", async () => {
    discord.sendChannelMessage.mockResolvedValue({ ok: false, status: 429, code: "HTTP_429", retryAfterMs: 65_000 });
    const id = (await recordStreamObservation(accountId, stream, new Date()))!;
    for (let attempt = 0; attempt < 3; attempt++) {
      await sendLiveAlert(accountId, id, stream);
      const delivery = await readDelivery(id);
      if (attempt < 2) {
        expect(+delivery.retryAt! - +delivery.lastAttemptAt!).toBeGreaterThanOrEqual(65_000);
        await prisma.streamAlertDelivery.update({ where: { streamId: id }, data: { retryAt: new Date(0) } });
      }
    }
    expect(await readDelivery(id)).toMatchObject({ status: "BLOCKED", retryCount: 2 });
    await sendLiveAlert(accountId, id, stream);
    expect(discord.sendChannelMessage).toHaveBeenCalledTimes(3);
  });

  it("preserves an administrator's pause when an in-flight send is rate limited", async () => {
    const id = (await recordStreamObservation(accountId, stream, new Date()))!;
    discord.sendChannelMessage.mockImplementationOnce(async () => {
      // The settings action records this marker while the claim is in flight.
      await prisma.streamAlertDelivery.update({ where: { streamId: id }, data: { reason: "ALERTS_OFF" } });
      return { ok: false, status: 429, code: "HTTP_429", retryAfterMs: 65_000 };
    });
    await sendLiveAlert(accountId, id, stream);
    const delivery = await readDelivery(id);
    expect(delivery).toMatchObject({ status: "SKIPPED", reason: "ALERTS_OFF", retryCount: 0 });
    expect(+delivery.retryAt! - +delivery.lastAttemptAt!).toBeGreaterThanOrEqual(65_000);
    await sendLiveAlert(accountId, id, stream);
    await sendLiveAlert(accountId, id, stream, true, { channelId, roleId: null });
    expect(discord.sendChannelMessage).toHaveBeenCalledTimes(1);
  });

  it("stops before contacting Discord if its claim has expired", async () => {
    const id = (await recordStreamObservation(accountId, stream, new Date()))!;
    const findClaim = prisma.streamAlertDelivery.findFirst.bind(prisma.streamAlertDelivery);
    const paused = vi.spyOn(prisma.streamAlertDelivery, "findFirst").mockImplementationOnce((query) => {
      // Prisma queries are lazy. Expire the lease before the pre-send read.
      const queryResult = findClaim(query);
      const expire = prisma.streamAlertDelivery.update({ where: { streamId: id }, data: { claimUntil: new Date(0) } });
      return expire.then(() => queryResult) as ReturnType<typeof findClaim>;
    });
    try {
      expect(await sendLiveAlert(accountId, id, stream)).toBe("UNCHANGED");
    } finally {
      paused.mockRestore();
    }
    expect(discord.sendChannelMessage).not.toHaveBeenCalled();
    await markStaleAlertClaims(guildId, id);
    expect(await readDelivery(id)).toMatchObject({ status: "UNCERTAIN" });
  });

  it("honors a terminal observation after a more recent live poll", async () => {
    const start = new Date(Date.now() - 30_000);
    const broadcast = { ...stream, startedAt: start };
    const id = (await recordStreamObservation(accountId, broadcast, start))!;
    await recordStreamObservation(accountId, broadcast, new Date(+start + 20_000));
    await recordStreamObservation(accountId, null, new Date(+start + 10_000), broadcast.providerStreamId);
    expect(await readDelivery(id)).toMatchObject({ status: "EXPIRED" });
    expect(await recordStreamObservation(accountId, broadcast, new Date())).toBeNull();
  });

  it("reconciles an ambiguous send with the existing Discord message", async () => {
    discord.sendChannelMessage.mockResolvedValue({ ok: false, code: "TIMEOUT" });
    const id = (await recordStreamObservation(accountId, stream, new Date()))!;
    await sendLiveAlert(accountId, id, stream);
    expect(await readDelivery(id)).toMatchObject({ status: "UNCERTAIN" });
    await sendLiveAlert(accountId, id, stream, true);
    discord.findOwnAlertMessage.mockResolvedValue({ id: referenceMessage, postedAt: new Date() });
    expect(await reconcileLiveAlert(guildId, id)).toBe(true);
    expect((await prisma.stream.findUniqueOrThrow({ where: { id } })).alertMessageId).toBe(referenceMessage);
    expect(discord.sendChannelMessage).toHaveBeenCalledTimes(1);
  });

  it("restores a post accepted by Discord when its message ID did not commit", async () => {
    const id = (await recordStreamObservation(accountId, stream, new Date()))!;
    discord.sendChannelMessage.mockResolvedValueOnce({
      ok: true,
      // Prisma rejects a non-string ID during the delivery commit.
      messageId: { invalid: true },
    });
    expect(await sendLiveAlert(accountId, id, stream)).toMatchObject({ code: "STREAM_DELIVERY_RECORD_FAILED" });
    expect(await readDelivery(id)).toMatchObject({ status: "UNCERTAIN" });
    discord.findOwnAlertMessage.mockResolvedValue({ id: referenceMessage, postedAt: new Date() });
    expect(await reconcileLiveAlert(guildId, id)).toBe(true);
    expect(discord.sendChannelMessage).toHaveBeenCalledTimes(1);
  });

  it("expires ended streams and converts abandoned claims to uncertain", async () => {
    const id = (await recordStreamObservation(accountId, stream, new Date()))!;
    await recordStreamObservation(accountId, null, new Date(), stream.providerStreamId);
    expect(await readDelivery(id)).toMatchObject({ status: "EXPIRED" });
    expect(await recordStreamObservation(accountId, stream, new Date())).toBeNull();
    const newer = { ...stream, startedAt: new Date(+stream.startedAt! + 100), providerStreamId: "new" };
    const next = (await recordStreamObservation(accountId, newer, new Date(+newer.startedAt + 100)))!;
    await prisma.streamAlertDelivery.update({
      where: { streamId: next }, data: { claim: "abandoned", claimUntil: new Date(0) },
    });
    await markStaleAlertClaims();
    expect(await readDelivery(next)).toMatchObject({ status: "UNCERTAIN" });
  });
});

it("shares the YouTube search cap across concurrent callers", async () => {
  const now = new Date("1970-06-01T12:00:00Z");
  const where = { day: "1970-06-01" };
  await prisma.youTubeSearchBudget.deleteMany({ where });
  vi.stubEnv("YOUTUBE_DAILY_SEARCH_LIMIT", "2");
  try {
    const results = await Promise.all([1, 2, 3, 4].map(() => reserveYouTubeSearch(now)));
    expect(results.filter(Boolean)).toHaveLength(2);
  } finally {
    vi.unstubAllEnvs();
    await prisma.youTubeSearchBudget.deleteMany({ where });
  }
});
