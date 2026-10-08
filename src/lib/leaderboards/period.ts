import { XPSource } from "@prisma/client";

/**
 * Leaderboard periods and which XP counts toward a rank.
 *
 * Pure date and set logic, kept apart from the queries so the boundaries can
 * be tested directly (PRD section 7.7).
 */

export type LeaderboardPeriod = "WEEKLY" | "MONTHLY" | "ALL_TIME";

export type LeaderboardMetric = "XP" | "ACTIVITY";

/**
 * Rolling windows rather than calendar weeks.
 *
 * A calendar week starts empty on Monday and a calendar month is empty on
 * the 1st, so both would show an empty board for part of every period.
 */
export const PERIOD_DAYS: Record<Exclude<LeaderboardPeriod, "ALL_TIME">, number> =
  {
    WEEKLY: 7,
    MONTHLY: 30,
  };

/**
 * The start of a rolling window, or null for all-time.
 *
 * "All time" has no start, which is how the queries know to use the stored
 * totals instead of summing transactions.
 */
export function periodStart(
  period: LeaderboardPeriod,
  now: Date = new Date(),
): Date | null {
  const days = PERIOD_DAYS[period as Exclude<LeaderboardPeriod, "ALL_TIME">];

  if (!days) return null;

  return new Date(now.getTime() - days * 86_400_000);
}

/**
 * XP sources that do not count toward a leaderboard.
 *
 * MANUAL is excluded because a moderator grant is an administrative action,
 * not something the member earned. Including it would let a single grant
 * put someone at the top of the board.
 */
export const EXCLUDED_XP_SOURCES: XPSource[] = [XPSource.MANUAL];

/** Whether an XP source should be ranked. */
export function isRankedXpSource(source: XPSource): boolean {
  return !EXCLUDED_XP_SOURCES.includes(source);
}

/** How each period reads from in a human-readable form. */
export const PERIOD_LABELS: Record<LeaderboardPeriod, string> = {
  WEEKLY: "Last 7 days",
  MONTHLY: "Last 30 days",
  ALL_TIME: "All time",
};

export const METRIC_LABELS: Record<LeaderboardMetric, string> = {
  XP: "XP",
  ACTIVITY: "Messages",
};