/**
 * Analytics date ranges and daily bucketing.
 *
 * Pure date logic, kept apart from the queries so the boundaries can be
 * tested directly (PRD section 7.12).
 */

export type AnalyticsRange = "7D" | "30D" | "90D";

export const RANGE_DAYS: Record<AnalyticsRange, number> = {
  "7D": 7,
  "30D": 30,
  "90D": 90,
};

/** Used when a range is missing or unrecognised. */
export const DEFAULT_RANGE: AnalyticsRange = "30D";

export const RANGE_LABELS: Record<AnalyticsRange, string> = {
  "7D": "Last 7 days",
  "30D": "Last 30 days",
  "90D": "Last 90 days",
};

/**
 * The largest range offered.
 *
 * A year of daily buckets is 365 points, which is more than a chart can show
 * legibly and more queries than V1 needs. Refusing the request server-side is
 * better than quietly returning a longer window than the page asked for.
 */
export const MAX_RANGE_DAYS = 90;

/** Whether a value is one of the offered ranges. */
export function isAnalyticsRange(value: string | undefined): value is AnalyticsRange {
  return (Object.keys(RANGE_DAYS) as string[]).includes(value ?? "");
}

/** The UTC midnight at the start of a date. */
function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/**
 * The start of a range, inclusive, snapped to a whole UTC day.
 *
 * Snapping matters for two reasons. A window ending at midday spans one more
 * calendar date than its name suggests, so "last 7 days" would produce eight
 * bars. And a partial first day would put the totals and the chart on
 * different boundaries, so a card and its graph could disagree.
 *
 * `days` counts today, so N days means N buckets.
 */
export function rangeStart(range: AnalyticsRange, now: Date = new Date()): Date {
  // Falls back rather than producing an Invalid Date. An invalid start would
  // make emptyBuckets return nothing at all, and a chart with no bars reads as
  // "no activity" rather than "bad request", which is worse than either.
  const days = RANGE_DAYS[range] ?? RANGE_DAYS[DEFAULT_RANGE];

  return new Date(startOfUtcDay(now).getTime() - (days - 1) * 86_400_000);
}

/**
 * The whole-day key for a date, in UTC.
 *
 * UTC on purpose. Local time would put each event in a different bucket
 * depending on where the server runs, and would make a day boundary land at
 * different hours on different machines. UTC keeps a day meaning the same thing
 * everywhere.
 */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** One day's totals. */
export interface DailyBucket {
  /** YYYY-MM-DD in UTC. */
  day: string;
  messages: number;
  xp: number;
  attendance: number;
  activeMembers: number;
}

/**
 * Fill in every day in a range, with zero for days nothing happened.
 *
 * Without this a chart draws a straight line from Monday to Friday when
 * nothing happened over the weekend, which reads as steady activity rather
 * than two quiet days.
 *
 * Walks from the start day to `now`, inclusive, and caps at `maxDays` so a
 * range cannot produce an unbounded number of buckets.
 */
export function emptyBuckets(start: Date, now: Date, maxDays = MAX_RANGE_DAYS): DailyBucket[] {
  const buckets: DailyBucket[] = [];
  const limit = Math.min(maxDays, MAX_RANGE_DAYS);

  // Start of the first day, so a partial range still labels whole days.
  const cursor = startOfUtcDay(start);
  const end = startOfUtcDay(now);

  while (cursor.getTime() <= end.getTime() && buckets.length < limit) {
    buckets.push({ day: dayKey(cursor), messages: 0, xp: 0, attendance: 0, activeMembers: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return buckets;
}

/**
 * Something that happened at a point in time.
 *
 * Named `createdAt` to match every timestamped model, so query rows can be
 * passed straight in without being reshaped first.
 */
export interface TimedEvent {
  createdAt: Date;
}

/**
 * Bucket events into days.
 *
 * Events outside the range are ignored rather than creating a bucket for a day
 * the chart does not have, which would render off the end of the axis.
 */
export function bucketEvents<T extends TimedEvent>(
  buckets: DailyBucket[],
  events: T[],
  apply: (bucket: DailyBucket, event: T) => void,
): DailyBucket[] {
  const index = new Map(buckets.map((bucket, position) => [bucket.day, position]));

  for (const event of events) {
    const position = index.get(dayKey(event.createdAt));

    if (position === undefined) continue;

    apply(buckets[position], event);
  }

  return buckets;
}

/**
 * Distinct members who did something on a day.
 *
 * Counted separately from messages, because "how many people were active" and
 * "how much did they say" are different questions and one member sending ten
 * messages is not ten active members.
 */
export function countDistinctByDay(
  buckets: DailyBucket[],
  events: Array<TimedEvent & { memberId: string }>,
): void {
  const seen = new Map<string, Set<string>>();

  for (const event of events) {
    const day = dayKey(event.createdAt);

    if (!seen.has(day)) seen.set(day, new Set());
    seen.get(day)!.add(event.memberId);
  }

  for (const bucket of buckets) {
    bucket.activeMembers = seen.get(bucket.day)?.size ?? 0;
  }
}

/** The largest value across a series, for scaling a chart. */
export function peakOf(buckets: DailyBucket[], key: keyof DailyBucket): number {
  return buckets.reduce((peak, bucket) => {
    const value = bucket[key];

    return typeof value === "number" && value > peak ? value : peak;
  }, 0);
}

/**
 * How a metric should be phrased, including what it does not count.
 *
 * Activity is measured from XP transactions, which only exist for messages
 * that earned XP. Saying so on the page is better than letting the number
 * imply it is every message sent.
 */
export const ACTIVITY_CAVEAT =
  "Messages counted here are the ones that earned XP. The cooldown, length and daily cap mean this is lower than every message sent.";