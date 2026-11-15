import "server-only";

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { checkTrackedYouTubeBroadcasts } from "@/lib/youtube/broadcast-tracking";
import { markStaleAlertClaims, recordStreamObservation, sendLiveAlert } from "./alert-delivery";
import { noteLiveCheckFailure, observeLiveStream, readYouTubeVideoStatus } from "./poller";
import { processStreamWebhookEvents, reconcileStreamWebhookSubscriptions } from "./provider-webhooks";

const log = createLogger("stream");
let running = false;
let nextSync = 0;

export async function runStreamMaintenance() {
  if (running) return;
  running = true;
  try {
    await markStaleAlertClaims();
    await processStreamWebhookEvents();
    await checkTrackedYouTubeBroadcasts();
    const due = await prisma.streamAlertDelivery.findMany({
      where: { status: "PENDING", claim: null, OR: [{ retryAt: null }, { retryAt: { lte: new Date() } }],
        stream: { endedAt: null } },
      include: { stream: { include: { streamingAccount: { include: { alertConfig: true } } } } },
      orderBy: { retryAt: "asc" }, take: 20,
    });
    for (const { stream, retryAt, lastAttemptAt } of due) {
      const observedAt = new Date();
      try {
        const account = stream.streamingAccount;
        if (account.disconnectedAt || !account.alertConfig?.enabled || !account.alertConfig.channelId) continue;
        const youtube = account.provider === "YOUTUBE"
          ? await readYouTubeVideoStatus(account, stream.providerStreamId) : null;
        const live = youtube ? youtube.live : await observeLiveStream(account);
        if (live?.providerStreamId === stream.providerStreamId) {
          const id = await recordStreamObservation(account.id, live, observedAt);
          if (id) await sendLiveAlert(account.id, id, live);
        } else if (live || !youtube || youtube.ended) {
          const id = await recordStreamObservation(account.id, live, observedAt,
            live ? undefined : stream.providerStreamId);
          if (id && live) await sendLiveAlert(account.id, id, live);
        } else {
          // Direct YouTube lookups can be unavailable temporarily. Discovery
          // and tracked-video polling supply definitive end observations.
          await prisma.streamAlertDelivery.updateMany({
            where: { streamId: stream.id, status: "PENDING", claim: null, retryAt, lastAttemptAt },
            data: { retryAt: new Date(Date.now() + 60_000) },
          });
          await noteLiveCheckFailure(account.id, observedAt);
        }
      } catch {
        // Provider failures leave delivery eligible for a later check.
        await noteLiveCheckFailure(stream.streamingAccountId, observedAt);
      }
    }
    if (Date.now() >= nextSync) {
      nextSync = Date.now() + 15 * 60_000;
      await reconcileStreamWebhookSubscriptions();
    }
  } catch {
    log.warn("Stream maintenance could not finish; work will be retried");
  } finally {
    running = false;
  }
}

let timer: NodeJS.Timeout | undefined;
export function startStreamMaintenance() {
  if (timer) return;
  timer = setInterval(() => void runStreamMaintenance(), 15_000);
  timer.unref?.();
  void runStreamMaintenance();
}
