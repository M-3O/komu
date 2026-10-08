/**
 * Message rate and join-spike detection.
 *
 * Both work on a sliding window of timestamps kept in memory rather than in
 * the database. A flood is a burst, and writing every message timestamp to
 * Postgres to notice one would cost more than it is worth. The cost is that
 * the window resets when the bot restarts, which for a rate limiter means a
 * brief lapse right after a deploy, not a way to slip past it deliberately.
 *
 * Pure and in-memory so they can be tested with a supplied clock.
 */

/** How many entries one member can hold before the oldest is dropped. */
const MAX_TRACKED_PER_KEY = 32;

/**
 * A sliding window of recent timestamps per key.
 *
 * Timestamps are kept sorted by pushing onto the end and dropping from the
 * front, which is enough for the handful of entries a window holds.
 */
export class SlidingWindow {
  private readonly entries = new Map<string, number[]>();

  /** Record an event, dropping anything now outside the window. */
  record(key: string, at: number, windowMs: number): void {
    const cutoff = at - windowMs;
    const list = (this.entries.get(key) ?? []).filter((stamp) => stamp > cutoff);

    list.push(at);

    // Bound the memory a spammy account can use.
    while (list.length > MAX_TRACKED_PER_KEY) list.shift();

    this.entries.set(key, list);
  }

  /** How many events fall inside the window ending at `at`. */
  count(key: string, at: number, windowMs: number): number {
    const cutoff = at - windowMs;
    const list = this.entries.get(key) ?? [];

    return list.filter((stamp) => stamp > cutoff && stamp <= at).length;
  }

  /** Forget a key, so a member starts from a clean slate. */
  clear(key: string): void {
    this.entries.delete(key);
  }

  /** Forget everything. Used by tests and on bot restart. */
  clearAll(): void {
    this.entries.clear();
  }

  /**
   * Drop keys that have no timestamps left inside the window.
   *
   * Without this, every member who ever spoke stays in the map for the life of
   * the process.
   */
  prune(at: number, windowMs: number): void {
    const cutoff = at - windowMs;

    for (const [key, list] of this.entries) {
      const kept = list.filter((stamp) => stamp > cutoff);

      if (kept.length === 0) {
        this.entries.delete(key);
      } else if (kept.length !== list.length) {
        this.entries.set(key, kept);
      }
    }
  }
}

/** A rule configured for rate or spike detection. */
export interface RateRule {
  /** Events allowed inside the window. */
  limit: number;
  /** Window length. */
  windowMs: number;
}

/**
 * Whether a key has exceeded its limit.
 *
 * Counted after recording, so `limit` messages is the boundary: at exactly the
 * limit nothing has happened yet, and the next one trips the rule.
 */
export function exceeded(rule: RateRule, count: number): boolean {
  return count > rule.limit;
}

/** A key that tripped a join-spike rule, with the events that did it. */
export interface SpikeResult<T> {
  tripped: boolean;
  /** The events inside the window, for the caller to act on. */
  events: T[];
}

/**
 * Decide whether recent join events are a raid.
 *
 * Takes the window rather than reaching for it, so the caller can prune and
 * inspect in one pass.
 */
export function detectSpike<T extends { at: number }>(
  events: T[],
  rule: RateRule,
  now: number,
): SpikeResult<T> {
  const cutoff = now - rule.windowMs;
  const inside = events.filter((event) => event.at > cutoff && event.at <= now);

  return { tripped: exceeded(rule, inside.length), events: inside };
}

/** The key used for a member's message rate. */
export function messageKey(guildId: string, memberId: string): string {
  return `${guildId}:msg:${memberId}`;
}

/** The key used for a guild's join rate. */
export function joinKey(guildId: string): string {
  return `${guildId}:join`;
}