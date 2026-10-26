/**
 * Raw Kick public API v1 response shapes.
 *
 * Verified against `GET /public/v1/channels?slug=...`, which wraps the result
 * in a `data` array. Kick answers a missing channel with HTTP 200, an empty
 * `data` array and sometimes a `message`, so the client checks the body rather
 * than the status code.
 */

export interface KickEnvelope<T> {
  data?: T;
  /** Present when the lookup failed, even on a 200. */
  message?: string;
  /** Present on rate limiting and auth failures. */
  error?: string | { message?: string; code?: string };
}

/** One channel from `GET /public/v1/channels?slug=...`. */
export interface KickChannel {
  /** Stable numeric user id. The login can change; this cannot. */
  broadcaster_user_id?: number;
  /** The login slug used in URLs, e.g. "xqc". */
  slug?: string;
  channel_description?: string;
  banner_picture?: string;
  /** Empty string while offline. */
  stream_title?: string;
  category?: { id?: number; name?: string; thumbnail?: string } | null;
  /** Always present; `is_live` is false while offline. */
  stream?: KickStream | null;
}

/** The broadcast block inside a channel response. */
export interface KickStream {
  is_live?: boolean;
  is_mature?: boolean;
  language?: string;
  /**
   * ISO 8601. Kick exposes no per-broadcast id, so this is the only stable
   * key for one stream session.
   */
  start_time?: string;
  viewer_count?: number;
  thumbnail?: string;
  url?: string;
}
