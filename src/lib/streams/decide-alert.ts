import type { StreamInfo } from "./types";

/**
 * Deciding whether a live stream should produce an alert.
 *
 * Kept as a pure function so the rule that matters most in this feature,
 * "alert exactly once per live session", can be tested without a database,
 * a provider or Discord.
 *
 * The provider gives us a `providerStreamId` that is stable for one live
 * session and changes when the creator starts a new one. That is what makes
 * de-duplication possible (PRD section 7.4).
 */

/** The session we already know about, if any. */
export interface KnownSession {
  providerStreamId: string;
  alertSentAt: Date | null;
  endedAt: Date | null;
}

export type AlertDecision =
  /**
   * The creator just went live and has not been alerted about. Carries the
   * stream so the caller does not have to re-check for null.
   */
  | { action: "ALERT"; stream: StreamInfo }
  /** Live, but this session has already been announced. */
  | { action: "SKIP_ALREADY_ALERTED"; providerStreamId: string }
  /**
   * Offline. Any open session should be closed, but nothing is sent.
   * Carries the session to close so a reconnect does not reopen it.
   */
  | { action: "CLOSE_SESSION"; providerStreamId: string | null };

/**
 * Decide what to do about a channel's current status.
 *
 * `known` is the most recent session we have recorded for this account, or
 * null when we have never seen them live.
 */
export function decideAlertAction(
  stream: StreamInfo | null,
  known: KnownSession | null,
): AlertDecision {
  // Offline. Close an open session so the next one is treated as new.
  if (!stream) {
    const openSession = known && known.endedAt === null ? known : null;

    return {
      action: "CLOSE_SESSION",
      providerStreamId: openSession?.providerStreamId ?? null,
    };
  }

  const sameSessionAsKnown = known?.providerStreamId === stream.providerStreamId;

  // Already announced this exact session: never alert twice.
  if (sameSessionAsKnown && known?.alertSentAt) {
    return { action: "SKIP_ALREADY_ALERTED", providerStreamId: stream.providerStreamId };
  }

  // A different session id means the creator stopped and restarted, which is
  // a fresh alert even if we alerted for the previous one.
  return { action: "ALERT", stream };
}