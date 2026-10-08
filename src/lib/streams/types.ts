import type { StreamingProvider } from "@prisma/client";

/**
 * The provider-neutral view of a live stream.
 *
 * Everything downstream of a provider — alerts, analytics, attendance —
 * reads this shape and never a Twitch, YouTube or Kick response. Each
 * provider module owns the translation into these fields (PRD section 7.3).
 *
 * Optional fields are nullable rather than defaulted, because "the provider
 * does not report this" and "it is zero" are different things.
 */
export interface StreamInfo {
  provider: StreamingProvider;

  /** The creator's id as this provider knows it. */
  creatorId: string;
  /** Channel login/name, lowercase on Twitch. Used to build the stream URL. */
  creatorUsername: string;
  /** Human-readable channel name. */
  creatorDisplayName: string | null;

  /**
   * This provider's id for the live session.
   *
   * Alerts are de-duplicated on this (PRD section 7.4), so it must change
   * when the creator starts a new stream and stay stable within one.
   */
  providerStreamId: string;

  title: string | null;
  /** Category or game. Null when the creator has not set one. */
  game: string | null;
  thumbnail: string | null;
  viewerCount: number | null;
  /** Canonical watch page. */
  url: string;
  startedAt: Date | null;
}

/** A creator's account on a provider, as returned by the provider. */
export interface ProviderAccount {
  providerUserId: string;
  /** Login/handle, lowercase where the provider requires it. */
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * What every streaming provider must be able to do.
 *
 * Intentionally small: connect an account, look one up, and ask whether the
 * creator is live. Adding a provider means implementing these three methods
 * and nothing else.
 */
export interface StreamingProviderAdapter {
  readonly provider: StreamingProvider;

  /** Look up a channel by login name or id, or null if it does not exist. */
  getAccount(identifier: string): Promise<ProviderAccount | null>;

  /** The current live stream, or null when the creator is offline. */
  getLiveStream(account: ProviderAccount): Promise<StreamInfo | null>;

  /** Convenience wrapper, for callers that do not need the stream details. */
  isLive(account: ProviderAccount): Promise<boolean>;
}