import { XPSource } from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  isRankedXpSource,
  periodStart,
  type LeaderboardMetric,
  type LeaderboardPeriod,
} from "./period";

/**
 * Leaderboard queries.
 *
 * Every query is scoped to a guild, because rankings must never leak across
 * servers once multi-server support exists (PRD section 7.7).
 *
 * Deliberately not marked `server-only`: the `/leaderboard` bot command
 * imports this, and `server-only` throws outside a Next.js server bundle.
 */

export interface LeaderboardEntry {
  memberId: string;
  discordId: string;
  username: string;
  nickname: string | null;
  /** XP or message count, depending on the metric. */
  value: number;
  level: number;
  totalXp: number;
}

export interface LeaderboardResult {
  entries: LeaderboardEntry[];
  period: LeaderboardPeriod;
  metric: LeaderboardMetric;
  /**
   * Set when the metric counts only XP-earning activity rather than every
   * message, so the dashboard can say so rather than mislead.
   */
  caveat?: string;
}

const DEFAULT_LIMIT = 10;

/**
 * Fetch a leaderboard.
 *
 * All-time reads the stored totals, which is why leaderboard queries can use
 * an indexed column instead of summing history (PRD section 14). Windowed
 * rankings have to sum transactions, because per-period totals are not
 * stored.
 */
export async function getLeaderboard(
  guildId: string,
  options: {
    period: LeaderboardPeriod;
    metric: LeaderboardMetric;
    limit?: number;
    now?: Date;
  },
): Promise<LeaderboardResult> {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), 100);
  const now = options.now ?? new Date();
  const since = periodStart(options.period, now);

  const rankedSources = Object.values(XPSource).filter(isRankedXpSource);

  if (since === null) {
    return allTimeBoard(guildId, options.metric, limit);
  }

  return options.metric === "XP"
    ? windowedXpBoard(guildId, since, rankedSources, limit, options)
    : windowedActivityBoard(guildId, since, limit, options);
}

/** All-time ranking from the stored member totals. */
async function allTimeBoard(
  guildId: string,
  metric: LeaderboardMetric,
  limit: number,
): Promise<LeaderboardResult> {
  const members = await prisma.guildMember.findMany({
    where: { guildId },
    select: {
      id: true,
      discordId: true,
      username: true,
      nickname: true,
      xp: true,
      level: true,
      messageCount: true,
    },
    orderBy: metric === "XP" ? { xp: "desc" } : { messageCount: "desc" },
    take: limit,
  });

  return {
    entries: members.map((member) => ({
      memberId: member.id,
      discordId: member.discordId,
      username: member.username,
      nickname: member.nickname,
      value: metric === "XP" ? member.xp : member.messageCount,
      level: member.level,
      totalXp: member.xp,
    })),
    period: "ALL_TIME",
    metric,
  };
}

/** XP earned inside the window, summed per member. */
async function windowedXpBoard(
  guildId: string,
  since: Date,
  rankedSources: XPSource[],
  limit: number,
  options: Pick<LeaderboardResult, "period" | "metric">,
): Promise<LeaderboardResult> {
  const grouped = await prisma.xPTransaction.groupBy({
    by: ["memberId"],
    where: {
      guildId,
      createdAt: { gte: since },
      source: { in: rankedSources },
    },
    _sum: { amount: true },
    orderBy: { _sum: { amount: "desc" } },
    take: limit,
  });

  const values = new Map(
    grouped.map((row) => [row.memberId, row._sum.amount ?? 0]),
  );

  const members = await prisma.guildMember.findMany({
    where: { guildId, id: { in: [...values.keys()] } },
    select: {
      id: true,
      discordId: true,
      username: true,
      nickname: true,
      xp: true,
      level: true,
    },
  });

  const entries = members
    .map((member) => ({
      memberId: member.id,
      discordId: member.discordId,
      username: member.username,
      nickname: member.nickname,
      value: values.get(member.id) ?? 0,
      level: member.level,
      totalXp: member.xp,
    }))
    // Re-sort: the database returned members in arbitrary id order.
    .sort((a, b) => b.value - a.value);

  return { entries, ...options };
}

/**
 * Activity inside the window.
 *
 * Counts messages that earned XP, which is every XP-granting message rather
 * than every message sent: the cooldown means most messages never became a
 * transaction. Stating this on the dashboard is better than letting the
 * number imply otherwise.
 */
async function windowedActivityBoard(
  guildId: string,
  since: Date,
  limit: number,
  options: Pick<LeaderboardResult, "period" | "metric">,
): Promise<LeaderboardResult> {
  const grouped = await prisma.xPTransaction.groupBy({
    by: ["memberId"],
    where: {
      guildId,
      createdAt: { gte: since },
      source: XPSource.MESSAGE,
    },
    _count: { _all: true },
    orderBy: { _count: { memberId: "desc" } },
    take: limit,
  });

  const counts = new Map(
    grouped.map((row) => [row.memberId, row._count._all]),
  );

  const members = await prisma.guildMember.findMany({
    where: { guildId, id: { in: [...counts.keys()] } },
    select: {
      id: true,
      discordId: true,
      username: true,
      nickname: true,
      xp: true,
      level: true,
    },
  });

  const entries = members
    .map((member) => ({
      memberId: member.id,
      discordId: member.discordId,
      username: member.username,
      nickname: member.nickname,
      value: counts.get(member.id) ?? 0,
      level: member.level,
      totalXp: member.xp,
    }))
    .sort((a, b) => b.value - a.value);

  return {
    entries,
    caveat:
      "Counts messages that earned XP, not every message sent.",
    ...options,
  };
}

/** A single member's rank within a leaderboard, or null if unranked. */
export async function getMemberRank(
  guildId: string,
  memberDiscordId: string,
  period: LeaderboardPeriod,
  metric: LeaderboardMetric,
  now?: Date,
): Promise<{ rank: number; value: number } | null> {
  const board = await getLeaderboard(guildId, {
    period,
    metric,
    limit: 100,
    now,
  });

  const index = board.entries.findIndex(
    (entry) => entry.discordId === memberDiscordId,
  );

  if (index === -1) return null;

  return { rank: index + 1, value: board.entries[index].value };
}