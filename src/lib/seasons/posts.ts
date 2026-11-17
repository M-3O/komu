import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { addChannelMessageButton, readChannelMessage, findOwnAlertMessage, sendChannelMessage, type DiscordButton } from "@/lib/discord/rest";
import { defuseMentions } from "@/lib/streams/build-alert-message";
import { CHECK_IN_PREFIX } from "./check-in";
import { CHECK_IN_GRACE, checkInDeadline, lockSeason, MINUTE, seasonsEnabled } from "./lifecycle";

export function seasonButton(broadcastId: string): DiscordButton {
  return { type: 2, style: 1, label: "Check in", custom_id: CHECK_IN_PREFIX + broadcastId };
}

export function appendSeasonButton<T extends {
  content?: string; components?: Array<{ type: 1; components: DiscordButton[] }>;
}>(
  payload: T, broadcastId: string, seasonName: string,
): T {
  const lines = (payload.content ?? "").split("\n");
  // Keep the delivery reference at the end for Discord recovery.
  lines.splice(Math.max(0, lines.length - 1), 0, `Season check-in · ${defuseMentions(seasonName)}`);
  const content = lines.filter(Boolean).join("\n");
  return { ...payload, content: content.length <= 2000 ? content : payload.content,
    components: [...(payload.components ?? []), { type: 1, components: [seasonButton(broadcastId)] }] };
}

export async function getSeasonAlertBinding(tx: Prisma.TransactionClient, streamId: string, now: Date) {
  if (!seasonsEnabled()) return null;
  return tx.seasonBroadcast.findFirst({
    where: { streamId, supersededAt: null, postMessageId: null,
      fallbackStatus: { in: ["PENDING", "BLOCKED"] },
      slot: { cancelledAt: null, season: { status: "ACTIVE", endsAt: { gt: now } } } },
    select: { id: true, slot: { select: { season: { select: { name: true } } } } },
  });
}

export async function linkSeasonAlert(
  tx: Prisma.TransactionClient, id: string, channelId: string, messageId: string, openedAt: Date,
) {
  const existing = await tx.seasonBroadcast.findUnique({ where: { id }, select: { openedAt: true } });
  const linked = await tx.seasonBroadcast.updateMany({
    where: { id, supersededAt: null, postMessageId: null, fallbackStatus: { in: ["PENDING", "BLOCKED"] },
      slot: { cancelledAt: null, season: { status: "ACTIVE", endsAt: { gt: openedAt } } } },
    data: { postChannelId: channelId, postMessageId: messageId, openedAt: existing?.openedAt ?? openedAt },
  });
  return Boolean(linked.count);
}

const bindingRelations = {
  stream: { include: { delivery: true, streamingAccount: { include: { alertConfig: true } } } },
  slot: { include: { season: true } },
} satisfies Prisma.SeasonBroadcastInclude;
type Binding = Prisma.SeasonBroadcastGetPayload<{ include: typeof bindingRelations }>;

function isOpen(binding: Binding, now: Date) {
  return !binding.supersededAt && !binding.slot.cancelledAt && binding.slot.season.status === "ACTIVE" &&
    +now < checkInDeadline(binding.openedAt ?? now, binding.stream.endedAt, binding.slot.season.endsAt);
}

async function attachOriginal(binding: Binding, now: Date) {
  const channelId = binding.stream.delivery?.channelId;
  const messageId = binding.stream.alertMessageId;
  if (!messageId || !channelId || !isOpen(binding, now)) return false;
  // A historic post can still be edited, so only open it for a current
  // observation or during the post-stream grace period.
  const account = binding.stream.streamingAccount;
  const observedAt = account.liveObservedAt;
  const failedAt = account.liveCheckFailedAt;
  const freshness = (account.provider === "YOUTUBE" ? 65 : 3) * MINUTE;
  if (!binding.stream.endedAt && (!observedAt || +now - +observedAt > freshness ||
      (failedAt && +failedAt > +observedAt))) return false;
  const result = await addChannelMessageButton(channelId, messageId, seasonButton(binding.id));
  if (!result.ok) return false;
  return linkSeasonAlert(prisma, binding.id, channelId, messageId, now);
}

export async function syncSeasonAlertPosts(now = new Date()) {
  if (!seasonsEnabled()) return;
  const bindings = await prisma.seasonBroadcast.findMany({
    where: { postMessageId: null, supersededAt: null, fallbackStatus: { in: ["PENDING", "BLOCKED"] },
      stream: { alertMessageId: { not: null }, delivery: { channelId: { not: null } },
        OR: [{ endedAt: null }, { endedAt: { gt: new Date(+now - CHECK_IN_GRACE) } }] },
      slot: { cancelledAt: null, season: { status: "ACTIVE", endsAt: { gt: now } } } },
    orderBy: { stream: { startedAt: "desc" } }, take: 20,
    include: bindingRelations,
  });
  for (const binding of bindings) {
    await attachOriginal(binding, now).catch(() => false);
  }
}

export async function publishSeasonCheckIn(guildId: string, id: string) {
  const now = new Date();
  const seed = await prisma.seasonBroadcast.findFirst({
    where: { id, slot: { season: { guildId } } }, include: bindingRelations,
  });
  if (!seed || !isOpen(seed, now)) return "This broadcast’s check-in window is closed.";
  if (seed.fallbackStatus === "SENT") return "The recovery post is already linked.";
  if (seed.postChannelId && seed.postMessageId && seed.fallbackStatus !== "UNCERTAIN" &&
      seed.fallbackStatus !== "CLAIMED") {
    const existing = await readChannelMessage(seed.postChannelId, seed.postMessageId);
    if (existing.status !== 404) return existing.ok ? "The existing check-in post is linked."
      : "Komu could not verify the linked post. Check the channel permissions.";
    await prisma.seasonBroadcast.updateMany({
      where: { id, postMessageId: seed.postMessageId },
      data: { postMessageId: null, postChannelId: null },
    });
  }

  const recovery = await checkFallbackHistory(seed, now);
  if (recovery) return recovery;
  if (!seed.postMessageId && await attachOriginal(seed, now)) return "Added check-in to the existing live alert.";
  if (seed.fallbackRetryAt && +seed.fallbackRetryAt > +now) return "Discord is rate limiting posts. Try again when the wait ends.";
  if (!seed.stream.endedAt) {
    const { confirmSeasonStream } = await import("./pinned-streams");
    const live = await confirmSeasonStream(seed.stream.streamingAccount, seed.stream.providerStreamId).catch(() => null);
    if (live?.providerStreamId !== seed.stream.providerStreamId) {
      return "The provider did not confirm this broadcast is still live.";
    }
  }

  const claim = randomUUID();
  const work = await prisma.$transaction(async (tx) => {
    await lockSeason(tx, seed.slot.seasonId);
    const binding = await tx.seasonBroadcast.findUnique({ where: { id }, include: bindingRelations });
    if (!binding || !isOpen(binding, new Date()) || binding.postMessageId ||
        (binding.fallbackRetryAt && +binding.fallbackRetryAt > Date.now()) ||
        !["PENDING", "BLOCKED"].includes(binding.fallbackStatus)) return null;
    const account = binding.stream.streamingAccount;
    const channelId = account.alertConfig?.channelId;
    if (!channelId || account.disconnectedAt) return null;
    const attemptedAt = new Date();
    const claimed = await tx.seasonBroadcast.updateMany({
      where: { id, postMessageId: null, fallbackStatus: binding.fallbackStatus },
      data: { fallbackStatus: "CLAIMED", fallbackClaim: claim, fallbackAttemptAt: attemptedAt,
        fallbackRetryAt: null, postChannelId: channelId },
    });
    return claimed.count ? { channelId, reference: binding.fallbackReference, seasonName: binding.slot.season.name } : null;
  });
  if (!work) return "No recovery post was sent. Check the destination and the current slot status.";

  const stillEligible = await prisma.seasonBroadcast.findFirst({
    where: { id, fallbackClaim: claim, supersededAt: null,
      fallbackAttemptAt: { gt: new Date(Date.now() - MINUTE) },
      slot: { cancelledAt: null, season: { status: "ACTIVE", endsAt: { gt: new Date() } } },
      stream: { OR: [{ endedAt: null }, { endedAt: { gt: new Date(Date.now() - CHECK_IN_GRACE) } }],
        streamingAccount: { disconnectedAt: null, alertConfig: { channelId: work.channelId } } } },
    select: { id: true },
  });
  if (!stillEligible) {
    await finishFallback(id, claim, "BLOCKED");
    return "The destination or active broadcast changed. Refresh the season and try again.";
  }
  try {
    const result = await sendChannelMessage(work.channelId, {
      content: `Check in for **${work.seasonName}**.\n-# Alert ref: ${work.reference}`,
      nonce: work.reference, allowedMentions: { parse: [] },
      components: [{ type: 1, components: [seasonButton(id)] }],
    });
    if (result.ok && result.messageId) {
      const completed = await finishFallback(id, claim, "SENT", result.messageId);
      return completed ? "Published the check-in post." : "Delivery needs confirmation. Check Discord before trying again.";
    }
    const definite = result.status !== undefined && [400, 401, 403, 404, 429].includes(result.status);
    const retryAt = result.status === 429 ? new Date(Date.now() + (result.retryAfterMs ?? MINUTE)) : undefined;
    await finishFallback(id, claim, definite ? "BLOCKED" : "UNCERTAIN", undefined, retryAt);
    return definite ? (result.error ?? "Discord refused the post. Check the destination.")
      : "Delivery is uncertain. Check Discord before trying again.";
  } catch {
    await finishFallback(id, claim, "UNCERTAIN").catch(() => undefined);
    return "Delivery is uncertain. Check Discord before trying again.";
  }
}

async function checkFallbackHistory(binding: Binding, now: Date) {
  if (binding.fallbackStatus === "CLAIMED") {
    if (!binding.fallbackAttemptAt || +binding.fallbackAttemptAt + MINUTE > +now) {
      return "A check-in post is being sent.";
    }
    await prisma.seasonBroadcast.updateMany({
      where: { id: binding.id, fallbackClaim: binding.fallbackClaim, fallbackStatus: "CLAIMED" },
      data: { fallbackStatus: "UNCERTAIN", fallbackClaim: null },
    });
  } else if (binding.fallbackStatus !== "UNCERTAIN") {
    return null;
  }
  const message = binding.postChannelId && binding.fallbackAttemptAt
    ? await findOwnAlertMessage(binding.postChannelId, binding.fallbackReference, binding.fallbackAttemptAt) : null;
  if (!message) return "The earlier send could not be verified. Komu will keep checking the same post when you retry recovery.";
  await prisma.seasonBroadcast.updateMany({
    where: { id: binding.id, fallbackStatus: "UNCERTAIN", postMessageId: null },
    data: { fallbackStatus: "SENT", postMessageId: message.id, openedAt: binding.openedAt ?? message.postedAt },
  });
  return "Recovered the existing check-in post.";
}

async function finishFallback(
  id: string, claim: string, status: "SENT" | "BLOCKED" | "UNCERTAIN", messageId?: string, retryAt?: Date,
) {
  const existing = await prisma.seasonBroadcast.findFirst({ where: { id, fallbackClaim: claim }, select: { openedAt: true } });
  if (!existing) return false;
  const saved = await prisma.seasonBroadcast.updateMany({
    where: { id, fallbackClaim: claim },
    data: { fallbackClaim: null, fallbackStatus: status, fallbackRetryAt: retryAt,
      ...(messageId ? { postMessageId: messageId, openedAt: existing.openedAt ?? new Date() } : {}) },
  });
  return Boolean(saved.count);
}
