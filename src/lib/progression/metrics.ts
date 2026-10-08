import type { ProgressionMetric } from "@prisma/client";

/**
 * Reading a member's progress on a metric.
 *
 * Shared by role rules and rewards, because both are "condition -> effect"
 * over the same numbers. Keeping one implementation means a threshold means
 * the same thing everywhere.
 *
 * Pure functions with no database access, so every threshold can be tested.
 */

/** The stored numbers a condition is measured against. */
export interface MemberStats {
  xp: number;
  level: number;
  messageCount: number;
  streamAttendanceCount: number;
  watchTimeMinutes: number;
  joinedAt: Date;
}

/** Whole days since a date, never negative. */
export function daysSince(date: Date, now: Date = new Date()): number {
  const elapsed = now.getTime() - date.getTime();
  if (elapsed <= 0) return 0;
  return Math.floor(elapsed / 86_400_000);
}

/**
 * The member's current value for a metric.
 *
 * Watch time is reported in hours because that is how thresholds are
 * configured; it is stored in minutes.
 */
export function metricValue(
  metric: ProgressionMetric,
  stats: MemberStats,
  now: Date = new Date(),
): number {
  switch (metric) {
    case "XP":
      return stats.xp;
    case "LEVEL":
      return stats.level;
    case "MESSAGE_COUNT":
      return stats.messageCount;
    case "STREAM_ATTENDANCE":
      return stats.streamAttendanceCount;
    case "WATCH_TIME_HOURS":
      return Math.floor(stats.watchTimeMinutes / 60);
    case "MEMBER_AGE_DAYS":
      return daysSince(stats.joinedAt, now);
  }
}

/** Whether a threshold is satisfied by a member's current value. */
export function meetsThreshold(
  metric: ProgressionMetric,
  threshold: number,
  stats: MemberStats,
  now: Date = new Date(),
): boolean {
  return metricValue(metric, stats, now) >= threshold;
}

/**
 * Metrics with a working data source in V1.
 *
 * Watch time is excluded because nothing populates it: Discord exposes no
 * watch telemetry, and attendance is counted as stream visits rather than
 * minutes. Offering a watch-time condition would create a rule that can
 * never fire, which is worse than saying so.
 */
export const AVAILABLE_METRICS: ProgressionMetric[] = [
  "LEVEL",
  "XP",
  "MESSAGE_COUNT",
  "STREAM_ATTENDANCE",
  "MEMBER_AGE_DAYS",
] as ProgressionMetric[];

/**
 * Metrics that exist in the schema but cannot work yet, with the reason.
 */
export const UNAVAILABLE_METRICS: Partial<Record<ProgressionMetric, string>> = {
  WATCH_TIME_HOURS:
    "Watch time is not collected. Komu records stream visits, not minutes watched.",
};

/** How each metric is phrased to a creator. */
export const METRIC_LABELS: Record<ProgressionMetric, string> = {
  XP: "Total XP reached",
  LEVEL: "Level reached",
  MESSAGE_COUNT: "Messages sent",
  STREAM_ATTENDANCE: "Streams attended",
  WATCH_TIME_HOURS: "Hours watched",
  MEMBER_AGE_DAYS: "Days in server",
};

/** The unit a metric is counted in, for wording. */
export const METRIC_UNITS: Record<ProgressionMetric, string> = {
  XP: "XP",
  LEVEL: "level",
  MESSAGE_COUNT: "messages",
  STREAM_ATTENDANCE: "streams",
  WATCH_TIME_HOURS: "hours watched",
  MEMBER_AGE_DAYS: "days in server",
};