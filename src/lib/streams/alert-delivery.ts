import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { findOwnAlertMessage, sendChannelMessage } from "@/lib/discord/rest";
import { classifyError, type ErrorCode } from "@/lib/monitoring/errors";
import { observeOperation } from "@/lib/monitoring/health";
import { buildAlertMessage } from "./build-alert-message";
import { decideAlertAction } from "./decide-alert";
import type { StreamInfo } from "./types";

const CLAIM_MS = 60_000;
export type AlertOutcome = "ALERTED" | "UNCHANGED" | "SKIPPED" | { code: ErrorCode };

export const deliveryAccount = Prisma.validator<Prisma.StreamingAccountDefaultArgs>()({
  include: { alertConfig: true },
});
export type DeliveryAccount = Prisma.StreamingAccountGetPayload<typeof deliveryAccount>;

function audience(account: DeliveryAccount) {
  const settings = account.alertConfig;
  return {
    channelId: settings?.channelId ?? null,
    roleId: settings?.mentionEnabled ? settings.mentionRoleId : null,
  };
}

function skipReason(account: DeliveryAccount) {
  if (account.disconnectedAt) return "DISCONNECTED";
  if (account.alertConfig?.enabled === false) return "ALERTS_OFF";
  if (!account.alertConfig?.channelId) return "NO_CHANNEL";
  return null;
}

// Serialize observations and claims for an account, without holding locks over HTTP.
export async function lockStreamAccount(tx: Prisma.TransactionClient, accountId: string) {
  await tx.$queryRaw`SELECT id FROM streaming_accounts WHERE id = ${accountId} FOR UPDATE`;
  return tx.streamingAccount.findUnique({ where: { id: accountId }, ...deliveryAccount });
}

async function expireOpenStreams(
  tx: Prisma.TransactionClient, accountId: string, endedAt: Date,
  scope?: { except: string } | { only: string },
) {
  const where = {
    streamingAccountId: accountId,
    endedAt: null,
    startedAt: { lte: endedAt },
    ...(scope && { providerStreamId: "only" in scope ? scope.only : { not: scope.except } }),
  };
  const open = await tx.stream.findMany({ where, select: { id: true } });
  const ids = open.map(({ id }) => id);
  if (!ids.length) return;
  await tx.stream.updateMany({ where: { id: { in: ids } }, data: { endedAt } });
  await tx.streamAlertDelivery.updateMany({
    where: { streamId: { in: ids }, status: { in: ["PENDING", "BLOCKED", "SKIPPED"] }, claim: null },
    data: { status: "EXPIRED", reason: "STREAM_ENDED", retryAt: null },
  });
}

export async function recordStreamObservation(
  accountId: string, stream: StreamInfo | null, observedAt: Date, endedKey?: string,
) {
  return observeOperation("database.stream-session", "postgres", () => prisma.$transaction(async (tx) => {
    const account = await lockStreamAccount(tx, accountId);
    if (!account || account.disconnectedAt) return null;
    if (!stream && endedKey) {
      // A terminal observation identifies a single broadcast. It can safely
      // close that row even if a newer poll or broadcast has already arrived.
      await observeOperation("database.stream-close", "postgres", () =>
        expireOpenStreams(tx, accountId, observedAt, { only: endedKey }));
      return null;
    }
    if (account.liveObservedAt && +account.liveObservedAt > +observedAt) return null;

    const latest = await tx.stream.findFirst({
      where: { streamingAccountId: accountId }, orderBy: { startedAt: "desc" },
      select: { providerStreamId: true, startedAt: true, endedAt: true, alertSentAt: true },
    });
    if (stream && latest && latest.providerStreamId !== stream.providerStreamId &&
      stream.startedAt && +latest.startedAt >= +stream.startedAt) return null;
    const decision = decideAlertAction(stream, latest);

    await tx.streamingAccount.update({ where: { id: accountId }, data: { liveObservedAt: observedAt } });
    if (decision.action === "CLOSE_SESSION") {
      await observeOperation("database.stream-close", "postgres", () => expireOpenStreams(tx, accountId, observedAt));
      return null;
    }
    if (decision.action === "SKIP_ALREADY_ALERTED") return null;
    const live = decision.stream;
    const key = { streamingAccountId: accountId, providerStreamId: live.providerStreamId };
    const existing = await tx.stream.findUnique({
      where: { streamingAccountId_providerStreamId: key },
      select: { id: true, endedAt: true },
    });
    if (existing) return existing.endedAt ? null : existing.id;

    await expireOpenStreams(tx, accountId, live.startedAt ?? observedAt, { except: live.providerStreamId });
    const reason = skipReason(account);
    const row = await observeOperation("database.stream-record", "postgres", () => tx.stream.create({
      data: {
        ...key, guildId: account.guildId, startedAt: live.startedAt ?? observedAt,
        title: live.title ?? "", game: live.game, thumbnailUrl: live.thumbnail,
        viewerCount: live.viewerCount,
        delivery: { create: {
          reference: randomBytes(9).toString("hex"),
          status: reason ? "SKIPPED" : "PENDING", reason, ...audience(account),
        } },
      },
      select: { id: true },
    }));
    return row.id;
  }));
}

function renderAlert(account: DeliveryAccount, stream: StreamInfo, reference: string) {
  const settings = account.alertConfig;
  if (!settings) return null;
  const { error, ...message } = buildAlertMessage({
    settings, stream, creatorName: account.displayName ?? account.username, deliveryReference: reference,
  });
  return error ? null : { ...message, nonce: reference };
}

export async function markStaleAlertClaims(guildId?: string, streamId?: string) {
  await prisma.streamAlertDelivery.updateMany({
    where: { streamId, ...(guildId ? { stream: { guildId } } : {}),
      claimUntil: { lte: new Date() }, claim: { not: null } },
    data: { status: "UNCERTAIN", reason: "SEND_INTERRUPTED", claim: null, claimUntil: null, retryAt: null },
  });
}

export async function sendLiveAlert(
  accountId: string, streamId: string, stream: StreamInfo, manual = false,
  expectedAudience?: { channelId: string; roleId: string | null },
): Promise<AlertOutcome> {
  const claim = randomUUID();
  const work = await prisma.$transaction(async (tx) => {
    const account = await lockStreamAccount(tx, accountId);
    if (!account) return null;
    const row = await tx.stream.findFirst({
      where: { id: streamId, streamingAccountId: accountId, providerStreamId: stream.providerStreamId, endedAt: null },
      include: { delivery: true },
    });
    const delivery = row?.delivery;
    if (!delivery || delivery.claim || row.alertSentAt) return null;
    if (delivery.status === "SKIPPED" && !manual) return { outcome: "SKIPPED" as const };
    if (delivery.status !== "PENDING" && !(manual && ["SKIPPED", "BLOCKED"].includes(delivery.status))) return null;
    const now = new Date();
    if (delivery.retryAt && +delivery.retryAt > +now) return null;

    const current = audience(account);
    const reason = skipReason(account);
    if (reason) {
      await tx.streamAlertDelivery.update({ where: { streamId }, data: { status: "SKIPPED", reason, retryAt: null } });
      return { outcome: "SKIPPED" as const };
    }
    if (manual && expectedAudience &&
      (current.channelId !== expectedAudience.channelId || current.roleId !== expectedAudience.roleId)) return null;
    if (!manual && (current.channelId !== delivery.channelId || current.roleId !== delivery.roleId)) {
      await tx.streamAlertDelivery.update({
        where: { streamId }, data: { status: "BLOCKED", reason: "AUDIENCE_CHANGED", retryAt: null },
      });
      return { outcome: "SKIPPED" as const };
    }
    const channelId = current.channelId!;
    const payload = renderAlert(account, stream, delivery.reference);
    if (!payload) {
      await tx.streamAlertDelivery.update({
        where: { streamId }, data: { status: "BLOCKED", reason: "INVALID_MESSAGE", retryAt: null, ...current },
      });
      return { outcome: { code: "STREAM_CONFIGURATION_INVALID" as const } };
    }
    const claimed = await tx.streamAlertDelivery.updateMany({
      where: { streamId, claim: null, status: delivery.status },
      data: { ...current, status: "PENDING", claim, claimUntil: new Date(+now + CLAIM_MS),
        lastAttemptAt: now, retryAt: null, reason: null },
    });
    return claimed.count ? { payload, channelId, roleId: current.roleId, retryCount: delivery.retryCount } : null;
  });
  if (!work) return "UNCHANGED";
  if ("outcome" in work) return work.outcome ?? "UNCHANGED";

  try {
    // A worker may resume after a pause, account change, or stream end.
    // Check that its claim is still usable immediately before issuing the POST.
    const current = await prisma.streamAlertDelivery.findFirst({
      where: { streamId, claim, claimUntil: { gt: new Date() } },
      select: { reason: true, stream: { select: { endedAt: true } } },
    });
    if (!current) return "UNCHANGED";
    if (current.reason || current.stream.endedAt) {
      const reason = current.stream.endedAt ? "STREAM_ENDED" : current.reason;
      const status = current.stream.endedAt ? "EXPIRED"
        : reason === "AUDIENCE_CHANGED" ? "BLOCKED" : "SKIPPED";
      await prisma.streamAlertDelivery.updateMany({
        where: { streamId, claim },
        data: { status, reason, claim: null, claimUntil: null },
      });
      return "SKIPPED";
    }
    const result = await sendChannelMessage(work.channelId, work.payload);
    if (result.ok && result.messageId) {
      await observeOperation("database.stream-delivery", "postgres", () => prisma.$transaction(async (tx) => {
        await lockStreamAccount(tx, accountId);
        const saved = await tx.streamAlertDelivery.updateMany({
          where: { streamId, claim },
          data: { status: "SENT", reason: null, claim: null, claimUntil: null },
        });
        if (!saved.count) throw new Error("Alert claim expired");
        await tx.stream.update({
          where: { id: streamId }, data: { alertSentAt: new Date(), alertMessageId: result.messageId },
        });
      }));
      return "ALERTED";
    }
    const definite = result.status !== undefined && [400, 401, 403, 404, 405, 429].includes(result.status);
    const limited = result.status === 429 && work.retryCount < 2;
    await prisma.$transaction(async (tx) => {
      const account = await lockStreamAccount(tx, accountId);
      const current = account && audience(account);
      const blocked = account ? skipReason(account) : "DISCONNECTED";
      const row = await tx.stream.findUnique({
        where: { id: streamId }, select: { endedAt: true, delivery: { select: { reason: true } } },
      });
      const paused = row?.delivery?.reason;
      const skip = blocked ?? (paused === "ALERTS_OFF" || paused === "NO_CHANNEL" || paused === "DISCONNECTED" ? paused : null);
      const changed = current?.channelId !== work.channelId ||
        current?.roleId !== work.roleId || paused === "AUDIENCE_CHANGED";
      const retry = limited && !row?.endedAt && !skip && !changed;
      const reason = definite ? (result.code ?? "DISCORD_REJECTED") : "DISCORD_OUTCOME_UNKNOWN";
      await tx.streamAlertDelivery.updateMany({
        where: { streamId, claim },
        data: {
          status: !definite ? "UNCERTAIN" : row?.endedAt ? "EXPIRED"
            : skip ? "SKIPPED" : retry ? "PENDING" : "BLOCKED",
          reason: !definite ? reason : row?.endedAt ? "STREAM_ENDED"
            : skip ?? (changed ? "AUDIENCE_CHANGED" : reason),
          retryCount: work.retryCount + Number(retry),
          retryAt: result.status === 429 && !row?.endedAt
            ? new Date(Date.now() + Math.max(1000, result.retryAfterMs ?? 60_000)) : null,
          claim: null, claimUntil: null,
        },
      });
    });
    return { code: classifyError(result, "discord") };
  } catch {
    // This includes a Discord acceptance followed by a failed database write.
    // If Postgres is still unavailable, the expired claim marks the same outcome.
    await prisma.streamAlertDelivery.updateMany({
      where: { streamId, claim },
      data: { status: "UNCERTAIN", reason: "SEND_INTERRUPTED", claim: null, claimUntil: null },
    }).catch(() => undefined);
    return { code: "STREAM_DELIVERY_RECORD_FAILED" };
  }
}

export async function reconcileLiveAlert(guildId: string, streamId: string) {
  await markStaleAlertClaims(guildId, streamId);
  const delivery = await prisma.streamAlertDelivery.findFirst({
    where: { streamId, stream: { guildId }, status: "UNCERTAIN" },
    include: { stream: { select: { streamingAccountId: true } } },
  });
  if (!delivery?.channelId || !delivery.lastAttemptAt) return false;
  const message = await findOwnAlertMessage(delivery.channelId, delivery.reference, delivery.lastAttemptAt);
  if (!message) return false;
  return prisma.$transaction(async (tx) => {
    await lockStreamAccount(tx, delivery.stream.streamingAccountId);
    const repaired = await tx.streamAlertDelivery.updateMany({
      where: { streamId, status: "UNCERTAIN", stream: { guildId } },
      data: { status: "SENT", reason: "MESSAGE_RECOVERED" },
    });
    if (!repaired.count) return false;
    await tx.stream.update({
      where: { id: streamId }, data: { alertSentAt: message.postedAt, alertMessageId: message.id },
    });
    return true;
  });
}
