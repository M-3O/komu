import "server-only";

import type { StreamingProvider } from "@prisma/client";
import { prisma } from "@/lib/db";
import { classifyError } from "@/lib/monitoring/errors";
import { observeOperation } from "@/lib/monitoring/health";
import { markStaleAlertClaims, recordStreamObservation, sendLiveAlert, type DeliveryAccount } from "./alert-delivery";
import { getStreamingProvider } from "./registry";
import { getVideo } from "@/lib/youtube/client";
import { normalizeLiveStream } from "@/lib/youtube/normalize";

export interface CycleResult {
  checked: number;
  alerted: number;
  failed: Array<{ channel: string; reason: string }>;
  skipped: number;
  unchanged: number;
}

export async function observeLiveStream(account: DeliveryAccount, videoId?: string) {
  return observeOperation(`provider.${account.provider}`, "provider", async () => {
    if (account.provider === "YOUTUBE" && videoId) {
      return (await readYouTubeVideoStatus(account, videoId)).live;
    }
    const adapter = getStreamingProvider(account.provider);
    if (!adapter) throw new Error("Streaming provider is unavailable.");
    return adapter.getLiveStream(account);
  });
}

export async function readYouTubeVideoStatus(account: DeliveryAccount, videoId: string) {
  const [video] = await getVideo(videoId);
  if (video?.id !== videoId || video.snippet?.channelId !== account.providerUserId) {
    return { live: null, ended: false };
  }
  const live = normalizeLiveStream(video);
  return {
    live: live ? { ...live, provider: "YOUTUBE" as const, creatorId: account.providerUserId } : null,
    ended: Number.isFinite(Date.parse(video.liveStreamingDetails?.actualEndTime ?? "")),
  };
}

export async function runStreamDetectionCycle(providers?: readonly StreamingProvider[]): Promise<CycleResult> {
  const result: CycleResult = { checked: 0, alerted: 0, failed: [], skipped: 0, unchanged: 0 };
  await markStaleAlertClaims();
  const accounts = await observeOperation("database.stream-load", "postgres", () =>
    prisma.streamingAccount.findMany({
      where: { disconnectedAt: null, ...(providers?.length ? { provider: { in: [...providers] } } : {}) },
      include: { alertConfig: true },
    }));
  for (const account of accounts) {
    result.checked++;
    const observedAt = new Date();
    let stream;
    let endedKey: string | undefined;
    try {
      stream = await observeLiveStream(account);
    } catch (error) {
      await noteLiveCheckFailure(account.id, observedAt);
      result.failed.push({ channel: account.provider, reason: classifyError(error, "provider") });
      continue;
    }
    try {
      // Scheduled/unlisted and on-demand videos are checked directly by ID.
      // An empty public YouTube search cannot end one of those sessions.
      if (!stream && account.provider === "YOUTUBE") {
        const open = await prisma.stream.findFirst({
          where: { streamingAccountId: account.id, endedAt: null }, orderBy: { startedAt: "desc" },
        });
        if (open) {
          const current = await readYouTubeVideoStatus(account, open.providerStreamId);
          if (current.live) stream = current.live;
          else if (!current.ended) {
            await noteLiveCheckFailure(account.id, observedAt);
            result.failed.push({ channel: account.provider, reason: "PROVIDER_REQUEST_FAILED" });
            continue;
          } else {
            endedKey = open.providerStreamId;
          }
        }
      }
      const streamId = await recordStreamObservation(account.id, stream, observedAt, endedKey);
      const outcome = stream && streamId && await sendLiveAlert(account.id, streamId, stream);
      if (outcome === "ALERTED") result.alerted++;
      else if (outcome === "SKIPPED") result.skipped++;
      else if (outcome && typeof outcome === "object") result.failed.push({ channel: account.provider, reason: outcome.code });
      else result.unchanged++;
    } catch (error) {
      result.failed.push({ channel: account.provider, reason: classifyError(error, "postgres") });
    }
  }
  return result;
}

export async function noteLiveCheckFailure(accountId: string, observedAt: Date) {
  try {
    await prisma.streamingAccount.updateMany({
      where: { id: accountId, OR: [{ liveCheckFailedAt: null }, { liveCheckFailedAt: { lt: observedAt } }] },
      data: { liveCheckFailedAt: observedAt },
    });
  } catch {
    // A monitoring write must not hide the original provider error.
  }
}
