import "server-only";

import { XPSource } from "@prisma/client";
import { io } from "next/cache";

import { prisma } from "@/lib/db";
import {
  bucketEvents,
  countDistinctByDay,
  emptyBuckets,
  rangeStart,
  RANGE_LABELS,
  type AnalyticsRange,
  type DailyBucket,
} from "./period";

/**
 * Community analytics (PRD section 7.12).
 *
 * Plain Prisma aggregates over data the application already stores. There is
 * no warehouse, no event bus and no cache: the plan rules those out for V1,
 * and for one server's worth of data they would be infrastructure to maintain
 * rather than speed worth having.
 *
 * Server-only because nothing outside a web request reads this.
 */

/** The numbers shown as cards. */
export interface AnalyticsTotals {
  range: AnalyticsRange;
  rangeLabel: string;
  totalMembers: number;
  newMembers: number;
  activeMembers: number;
  messages: number;
  xpEarned: number;
  attendance: number;
  rewardsGranted: number;
  challengesCompleted: number;
  achievementsUnlocked: number;
}

export interface AnalyticsReport {
  totals: AnalyticsTotals;
  daily: DailyBucket[];
  /**
   * Metrics that exist in the PRD but have no data source.
   *
   * Watch time is listed rather than silently omitted, so the page can say why
   * it is missing instead of leaving a creator wondering.
   */
  unavailable: Array<{ metric: string; reason: string }>;
}

/**
 * Everything on the analytics page for one range.
 *
 * The daily buckets and the totals come from the same transactions, so they
 * cannot disagree.
 */
export async function getAnalytics(
  range: AnalyticsRange,
  now?: Date,
): Promise<AnalyticsReport> {
  // The clock read is declared as an IO operation first, so it stays out of the
  // static shell. `io()` takes no arguments: under Cache Components a bare
  // `new Date()` in a prerendered tree is an unstable value, which fails the
  // build rather than baking in a stale "now".
  //
  // Deliberately not a default parameter. `now: Date = new Date()` evaluates at
  // the call site, before this function body runs, so the guard below would
  // come too late and the build would still fail.
  await io();

  const clock = now ?? new Date();
  const start = rangeStart(range, clock);

  const guild = await prisma.guild.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!guild) {
    return {
      totals: emptyTotals(range),
      daily: emptyBuckets(start, clock),
      unavailable: UNAVAILABLE_METRICS,
    };
  }

  const daily = emptyBuckets(start, clock);

  const [
    totalMembers,
    newMembers,
    transactions,
    attendanceRows,
    rewardGrants,
    challengeCompletions,
    achievementUnlocks,
  ] = await Promise.all([
    prisma.guildMember.count({ where: { guildId: guild.id } }),
    // `joinedAt` is the real Discord join date, so this counts members who
    // actually joined in the window, not when Komu first saw them.
    prisma.guildMember.count({ where: { guildId: guild.id, joinedAt: { gte: start } } }),
    prisma.xPTransaction.findMany({
      where: { guildId: guild.id, createdAt: { gte: start } },
      select: { createdAt: true, amount: true, source: true, memberId: true },
    }),
    // StreamAttendance has no guildId of its own, so it is scoped through the
// member. Filtering by member rather than stream is right either way here:
// attendance only exists for members of this guild.
prisma.streamAttendance.findMany({
      where: {
        member: { guildId: guild.id },
        createdAt: { gte: start },
      },
      select: { createdAt: true },
    }),
    prisma.rewardGrant.count({ where: { guildId: guild.id, createdAt: { gte: start } } }),
    prisma.challengeProgress.count({
      where: { guildId: guild.id, completedAt: { gte: start } },
    }),
    prisma.memberAchievement.count({
      where: { guildId: guild.id, unlockedAt: { gte: start } },
    }),
  ]);

  // Only message transactions count as messages. Reward, achievement and
  // challenge XP are payouts, and counting them as activity would report a
  // quiet day as a busy one.
  const messageTransactions = transactions.filter(
    (transaction) => transaction.source === XPSource.MESSAGE,
  );

  // Messages and the XP they earned come from the same transactions, so the
  // chart and the cards cannot disagree.
  bucketEvents(daily, messageTransactions, (bucket, transaction) => {
    bucket.messages += 1;
    bucket.xp += transaction.amount;
  });

  bucketEvents(daily, attendanceRows, (bucket) => {
    bucket.attendance += 1;
  });

  countDistinctByDay(daily, messageTransactions);

  const totals: AnalyticsTotals = {
    range,
    rangeLabel: RANGE_LABELS[range],
    totalMembers,
    newMembers,
    activeMembers: new Set(messageTransactions.map((transaction) => transaction.memberId)).size,
    messages: messageTransactions.length,
    xpEarned: messageTransactions.reduce((sum, transaction) => sum + transaction.amount, 0),
    attendance: attendanceRows.length,
    rewardsGranted: rewardGrants,
    challengesCompleted: challengeCompletions,
    achievementsUnlocked: achievementUnlocks,
  };

  return { totals, daily, unavailable: UNAVAILABLE_METRICS };
}

function emptyTotals(range: AnalyticsRange): AnalyticsTotals {
  return {
    range,
    rangeLabel: RANGE_LABELS[range],
    totalMembers: 0,
    newMembers: 0,
    activeMembers: 0,
    messages: 0,
    xpEarned: 0,
    attendance: 0,
    rewardsGranted: 0,
    challengesCompleted: 0,
    achievementsUnlocked: 0,
  };
}

/**
 * PRD metrics with no data source in V1.
 *
 * Watch time is listed rather than omitted. Discord exposes no watch telemetry
 * and attendance is counted as stream visits rather than minutes, so the field
 * is never populated. Saying so is more useful than a card reading zero.
 */
export const UNAVAILABLE_METRICS: Array<{ metric: string; reason: string }> = [
  {
    metric: "Watch time",
    reason:
      "Watch time is not collected. Komu records stream visits, not minutes watched.",
  },
];

/** Compares this range against the one before it, for the trend arrows. */
export interface AnalyticsTrend {
  metric: string;
  current: number;
  previous: number;
}

export async function getAnalyticsTrend(
  range: AnalyticsRange,
  now?: Date,
): Promise<AnalyticsTrend[]> {
  // Same reason as getAnalytics: a default parameter would evaluate the clock
  // read at the call site, before the io() guard runs.
  await io();

  const clock = now ?? new Date();
  const currentStart = rangeStart(range, clock);
  const previousStart = new Date(
    currentStart.getTime() - (clock.getTime() - currentStart.getTime()),
  );

  const guild = await prisma.guild.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!guild) return [];

  const [current, previous] = await Promise.all([
    prisma.xPTransaction.count({
      where: {
        guildId: guild.id,
        createdAt: { gte: currentStart },
        source: XPSource.MESSAGE,
      },
    }),
    prisma.xPTransaction.count({
      where: {
        guildId: guild.id,
        createdAt: { gte: previousStart, lt: currentStart },
        source: XPSource.MESSAGE,
      },
    }),
  ]);

  return [{ metric: "Messages", current, previous }];
}