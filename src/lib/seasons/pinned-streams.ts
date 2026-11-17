import "server-only";

import { prisma } from "@/lib/db";
import { observeLiveStream, readYouTubeVideoStatus } from "@/lib/streams/poller";
import { recordStreamObservation, sendLiveAlert } from "@/lib/streams/alert-delivery";
import { EARLY, LATE, MINUTE, seasonsEnabled } from "./lifecycle";

export async function pollPinnedSeasonStreams(now = new Date()) {
  if (!seasonsEnabled()) return;
  const due = await prisma.seasonSlot.findMany({
    where: { videoId: { not: null }, cancelledAt: null, nextVideoCheckAt: { lte: now },
      season: { status: "ACTIVE", endsAt: { gt: now } },
      account: { disconnectedAt: null, provider: "YOUTUBE" } },
    include: { account: { include: { alertConfig: true } },
      broadcasts: { where: { supersededAt: null }, include: { stream: { select: { providerStreamId: true, endedAt: true } } } } },
    orderBy: { nextVideoCheckAt: "asc" }, take: 25,
  });
  for (const slot of due) {
    const binding = slot.broadcasts[0];
    const stop = binding ? binding.stream.endedAt || binding.stream.providerStreamId !== slot.videoId
      : +now > +slot.scheduledAt + LATE;
    const followUp = stop ? null : new Date(+now + MINUTE);
    const claimed = await prisma.seasonSlot.updateMany({
      where: { id: slot.id, videoId: slot.videoId, cancelledAt: null, nextVideoCheckAt: slot.nextVideoCheckAt },
      data: { nextVideoCheckAt: followUp },
    });
    if (!claimed.count || stop || !slot.videoId || +now < +slot.scheduledAt - EARLY) continue;
    try {
      const observedAt = new Date();
      const status = await readYouTubeVideoStatus(slot.account, slot.videoId);
      if (status.ended) {
        await recordStreamObservation(slot.accountId, null, observedAt, slot.videoId);
        await prisma.seasonSlot.updateMany({ where: { id: slot.id, nextVideoCheckAt: followUp }, data: { nextVideoCheckAt: null } });
      } else if (status.live) {
        const id = await recordStreamObservation(slot.accountId, status.live, observedAt);
        if (id) await sendLiveAlert(slot.accountId, id, status.live);
      }
    } catch {
      // The reservation expires in one minute. A provider error cannot end a session.
    }
  }
}

export async function confirmSeasonStream(
  account: Parameters<typeof observeLiveStream>[0], videoId?: string,
) {
  if (account.provider === "YOUTUBE" && videoId) return (await readYouTubeVideoStatus(account, videoId)).live;
  return observeLiveStream(account);
}
