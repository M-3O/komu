/**
 * The daily XP window.
 *
 * `xpToday` is a running total that has to reset, otherwise the daily cap
 * would eventually lock a member out permanently. Rather than a cron or a
 * scheduled job, the counter is reset lazily: whenever it is read, if the
 * stored reset time has passed, today's total is treated as zero.
 *
 * That keeps V1 free of scheduled work, which the plan rules out.
 */

/** A UTC midnight, the boundary between days. */
export function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export interface DailyWindow {
  /** XP already earned in the current day. */
  xpToday: number;
  /** When the counter should next reset. */
  resetAt: Date;
  /** True when the stored counter was from an earlier day. */
  needsReset: boolean;
}

/**
 * Work out today's XP total and when to reset it.
 *
 * A member who has never earned XP (`xpTodayResetAt` is null) is treated as
 * having a fresh window starting today.
 */
export function dailyWindow(
  xpToday: number,
  lastResetAt: Date | null,
  now: Date = new Date(),
): DailyWindow {
  const todayStart = startOfUtcDay(now);
  const tomorrowStart = new Date(todayStart.getTime() + 86_400_000);

  if (!lastResetAt || lastResetAt < todayStart) {
    return { xpToday: 0, resetAt: tomorrowStart, needsReset: true };
  }

  return { xpToday, resetAt: tomorrowStart, needsReset: false };
}

/**
 * How much of an award survives the daily cap.
 *
 * A cap of zero or less means "no cap", so the full amount passes through.
 */
export function applyDailyCap(
  requested: number,
  alreadyToday: number,
  dailyCap: number,
): number {
  if (dailyCap <= 0) return requested;

  const remaining = Math.max(dailyCap - alreadyToday, 0);
  return Math.min(requested, remaining);
}