/**
 * Timeout duration handling.
 *
 * Split out from the moderation service so the maths can be unit tested
 * without a Discord client or a live member.
 */

/** Discord's maximum timeout: 28 days. */
export const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

/** Shortest timeout Discord accepts, used as a floor. */
export const MIN_TIMEOUT_MS = 1000;

/**
 * Clamp a requested timeout into the range Discord accepts.
 *
 * Guards the dashboard and `/timeout` against a zero value (which would mean
 * "remove timeout" rather than "time out") and against a duration past
 * Discord's 28 day ceiling, which the API rejects.
 */
export function clampTimeoutMs(durationMs: number): number {
  if (!Number.isFinite(durationMs)) return MIN_TIMEOUT_MS;
  return Math.min(Math.max(durationMs, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}