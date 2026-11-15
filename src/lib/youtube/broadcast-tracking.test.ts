import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  account: vi.fn(), video: vi.fn(), upsert: vi.fn(), due: vi.fn(), update: vi.fn(),
  observe: vi.fn(), send: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: {
  streamingAccount: { findFirst: mocks.account },
  youTubeBroadcastTracking: { upsert: mocks.upsert, findMany: mocks.due, updateMany: mocks.update },
} }));
vi.mock("./client", () => ({ getVideo: mocks.video }));
vi.mock("@/lib/streams/poller", () => ({ noteLiveCheckFailure: vi.fn() }));
vi.mock("@/lib/streams/alert-delivery", () => ({
  deliveryAccount: {}, recordStreamObservation: mocks.observe, sendLiveAlert: mocks.send,
}));

import { checkTrackedYouTubeBroadcasts, checkYouTubeBroadcast, parseYouTubeBroadcastLink } from "./broadcast-tracking";

const id = "abcdefghijk";
const link = `https://www.youtube.com/watch?v=${id}`;
const account = { id: "account", providerUserId: "channel" };
const start = new Date(Date.now() + 40 * 60_000);
const video = { id, snippet: { channelId: account.providerUserId },
  liveStreamingDetails: { scheduledStartTime: start.toISOString() } };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.account.mockResolvedValue(account);
  mocks.video.mockResolvedValue([video]);
  mocks.observe.mockResolvedValue("session");
  mocks.update.mockResolvedValue({ count: 1 });
});

it("parses supported video links and rejects other domains", () => {
  expect(parseYouTubeBroadcastLink(link)).toBe(id);
  expect(parseYouTubeBroadcastLink(`https://youtu.be/${id}`)).toBe(id);
  expect(parseYouTubeBroadcastLink(`https://www.youtube.com.evil.test/watch?v=${id}`)).toBeNull();
});

it("tracks from 30 minutes before the scheduled start without posting", async () => {
  expect(await checkYouTubeBroadcast("guild", account.id, link, true)).toBeNull();
  expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
    update: expect.objectContaining({ videoId: id, nextCheckAt: new Date(+start - 30 * 60_000) }),
  }));
  expect(mocks.send).not.toHaveBeenCalled();
});

it("rejects a different channel and an ended broadcast", async () => {
  mocks.video.mockResolvedValueOnce([{ ...video, snippet: { channelId: "other" } }]);
  expect(await checkYouTubeBroadcast("guild", account.id, link, true)).toMatch(/different/);
  mocks.video.mockResolvedValueOnce([{ ...video, liveStreamingDetails: {
    actualStartTime: new Date(0).toISOString(), actualEndTime: new Date().toISOString(),
  } }]);
  expect(await checkYouTubeBroadcast("guild", account.id, link, false)).toMatch(/still live|confirmed/);
  expect(mocks.send).not.toHaveBeenCalled();
});

it("checks a direct video ID and sends through the same delivery service", async () => {
  mocks.video.mockResolvedValueOnce([{ ...video, liveStreamingDetails: { actualStartTime: new Date().toISOString() } }]);
  expect(await checkYouTubeBroadcast("guild", account.id, link, false)).toBeNull();
  expect(mocks.video).toHaveBeenCalledWith(id);
  expect(mocks.send).toHaveBeenCalledWith(account.id, "session", expect.objectContaining({ providerStreamId: id }));
});

it("moves the tracking window when a scheduled video is rescheduled", async () => {
  const now = new Date();
  mocks.due.mockResolvedValueOnce([{ account, streamingAccountId: account.id, videoId: id,
    scheduledAt: new Date(+now - 30 * 60_000), nextCheckAt: now }]);
  await checkTrackedYouTubeBroadcasts(now);
  expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({
    data: expect.objectContaining({ scheduledAt: start, nextCheckAt: new Date(+start - 30 * 60_000) }),
  }));
  expect(mocks.send).not.toHaveBeenCalled();
});
