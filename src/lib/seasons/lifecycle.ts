import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";

export const MINUTE = 60_000;
export const EARLY = 30 * MINUTE;
export const LATE = 60 * MINUTE;
export const CHECK_IN_GRACE = 15 * MINUTE;
export const MAX_CHECK_IN = 6 * 60 * MINUTE;

export function seasonsEnabled() {
  return process.env.KOMU_SEASONS_ENABLED === "true";
}

export function checkInDeadline(openedAt: Date, endedAt: Date | null, seasonEnd: Date) {
  return Math.min(+openedAt + MAX_CHECK_IN, endedAt ? +endedAt + CHECK_IN_GRACE : Infinity, +seasonEnd);
}

export function schedulesOverlap(a: { accountId: string; scheduledAt: Date }, b: typeof a) {
  return a.accountId === b.accountId && Math.abs(+a.scheduledAt - +b.scheduledAt) <= EARLY + LATE;
}

export async function lockSeason(tx: Prisma.TransactionClient, seasonId: string) {
  await tx.$queryRaw`SELECT id FROM seasons WHERE id = ${seasonId} FOR UPDATE`;
}

export function createSeasonBroadcast(tx: Prisma.TransactionClient, slotId: string, streamId: string) {
  return tx.seasonBroadcast.create({
    data: { slotId, streamId, fallbackReference: randomBytes(9).toString("hex") },
  });
}

export async function matchSeasonStream(tx: Prisma.TransactionClient, stream: {
  id: string; guildId: string; streamingAccountId: string; startedAt: Date; observedAt: Date; providerStreamId: string;
}) {
  if (!seasonsEnabled()) return;
  const active = await tx.season.findFirst({
    where: { guildId: stream.guildId, status: "ACTIVE", endsAt: { gt: stream.observedAt } },
    select: { id: true },
  });
  if (!active) return;
  await lockSeason(tx, active.id);
  const slot = await tx.seasonSlot.findFirst({
    where: {
      seasonId: active.id, season: { status: "ACTIVE", endsAt: { gt: stream.observedAt },
        activatedAt: { lte: stream.startedAt } },
      accountId: stream.streamingAccountId, cancelledAt: null, broadcasts: { none: {} },
      scheduledAt: { gte: new Date(+stream.startedAt - LATE), lte: new Date(+stream.startedAt + EARLY) },
      OR: [{ videoId: null }, { videoId: stream.providerStreamId }],
    },
    orderBy: { scheduledAt: "asc" },
  });
  if (slot && !await tx.seasonBroadcast.findUnique({ where: { streamId: stream.id } })) {
    await createSeasonBroadcast(tx, slot.id, stream.id);
  }
}
