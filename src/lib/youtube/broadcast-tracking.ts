import "server-only";

import { prisma } from "@/lib/db";
import { deliveryAccount, recordStreamObservation, sendLiveAlert, type DeliveryAccount } from "@/lib/streams/alert-delivery";
import { noteLiveCheckFailure } from "@/lib/streams/poller";
import { getVideo } from "./client";
import { normalizeLiveStream } from "./normalize";
import type { YouTubeVideoItem } from "./types";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function nextVideoCheck(now: Date, scheduledAt: Date | null, live: boolean) {
  const startsCheckingAt = scheduledAt ? +scheduledAt - 30 * MINUTE : +now;
  // Check far-future bookings periodically so an earlier reschedule is noticed.
  return new Date(live ? +now + MINUTE
    : Math.min(+now + 15 * MINUTE, Math.max(+now + MINUTE, startsCheckingAt)));
}

export function parseYouTubeBroadcastLink(input: string) {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const id = url.hostname === "youtu.be" ? url.pathname.slice(1)
      : ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)
        ? (url.pathname === "/watch" ? url.searchParams.get("v") : /^\/live\/([^/]+)$/.exec(url.pathname)?.[1])
        : null;
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function date(value?: string) {
  const timestamp = value ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

async function applyVideo(account: DeliveryAccount, video: YouTubeVideoItem, observedAt: Date) {
  if (video.snippet?.channelId !== account.providerUserId || !video.id) return;
  if (date(video.liveStreamingDetails?.actualEndTime)) {
    await recordStreamObservation(account.id, null, observedAt, video.id);
    return;
  }
  const normalized = normalizeLiveStream(video);
  if (!normalized) return;
  const stream = { ...normalized, provider: "YOUTUBE" as const, creatorId: account.providerUserId };
  const streamId = await recordStreamObservation(account.id, stream, observedAt);
  if (streamId) await sendLiveAlert(account.id, streamId, stream);
}

export async function checkYouTubeBroadcast(guildId: string, accountId: string, url: string, track: boolean) {
  const videoId = parseYouTubeBroadcastLink(url);
  if (!videoId) return "Enter a YouTube watch or live link.";
  const account = await prisma.streamingAccount.findFirst({
    where: { id: accountId, guildId, provider: "YOUTUBE", disconnectedAt: null }, ...deliveryAccount,
  });
  if (!account) return "Choose a connected YouTube channel.";
  const now = new Date();
  const [video] = await getVideo(videoId);
  if (video?.id !== videoId || video.snippet?.channelId !== account.providerUserId) {
    return "This broadcast is unavailable or belongs to a different YouTube channel.";
  }
  const scheduledAt = date(video.liveStreamingDetails?.scheduledStartTime);
  const live = normalizeLiveStream(video);
  const endedAt = date(video.liveStreamingDetails?.actualEndTime);
  if (track && !endedAt && (scheduledAt || live)) {
    const nextCheckAt = nextVideoCheck(now, scheduledAt, Boolean(live));
    const data = { videoId, scheduledAt, nextCheckAt, endedAt: null };
    await prisma.youTubeBroadcastTracking.upsert({
      where: { streamingAccountId: account.id },
      create: { streamingAccountId: account.id, ...data }, update: data,
    });
  } else if (!track && !live) {
    return "YouTube has not confirmed that this broadcast is live.";
  } else if (track && (endedAt || (!scheduledAt && !live))) {
    return "Choose a scheduled or currently live broadcast.";
  }
  await applyVideo(account, video, now);
  return null;
}

export async function checkTrackedYouTubeBroadcasts(now = new Date()) {
  const due = await prisma.youTubeBroadcastTracking.findMany({
    where: { endedAt: null, nextCheckAt: { lte: now }, account: { disconnectedAt: null } },
    include: { account: deliveryAccount }, orderBy: { nextCheckAt: "asc" }, take: 50,
  });
  for (const row of due) {
    const where = { streamingAccountId: row.streamingAccountId, videoId: row.videoId };
    const nextCheckAt = new Date(+now + MINUTE);
    const claim = await prisma.youTubeBroadcastTracking.updateMany({
      where: { ...where, nextCheckAt: row.nextCheckAt }, data: { nextCheckAt },
    });
    if (!claim.count) continue;
    try {
      const [video] = await getVideo(row.videoId);
      if (video?.id !== row.videoId || video.snippet?.channelId !== row.account.providerUserId) {
        await noteLiveCheckFailure(row.account.id, now);
        if (row.scheduledAt && +now >= +row.scheduledAt + DAY) {
          await prisma.youTubeBroadcastTracking.updateMany({ where: { ...where, nextCheckAt }, data: { endedAt: now } });
        }
        continue;
      }
      const scheduledAt = date(video.liveStreamingDetails?.scheduledStartTime) ?? row.scheduledAt;
      const endedAt = date(video.liveStreamingDetails?.actualEndTime);
      const live = Boolean(normalizeLiveStream(video));
      const expired = scheduledAt && !live && +now >= +scheduledAt + DAY;
      const updated = await prisma.youTubeBroadcastTracking.updateMany({
        where: { ...where, nextCheckAt },
        data: { scheduledAt, endedAt: endedAt ?? (expired ? now : null),
          nextCheckAt: nextVideoCheck(now, scheduledAt, live) },
      });
      if (updated.count) await applyVideo(row.account, video, now);
    } catch {
      // Retry the next minute. An unavailable provider cannot mark a stream ended.
      await noteLiveCheckFailure(row.account.id, now);
    }
  }
}
