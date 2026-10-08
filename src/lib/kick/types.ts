/**
 * Raw Kick public API v1 response shapes.
 *
 * Kick wraps everything in a `data` envelope and returns HTTP 200 with a
 * `message` and no `data` when a channel does not exist, so the client has to
 * check the body rather than the status code.
 */

export interface KickEnvelope<T> {
  data?: T;
  /** Present when the lookup failed, even on a 200. */
  message?: string;
  /** Present on rate limiting and auth failures. */
  error?: string | { message?: string; code?: string };
}

export interface KickChannel {
  id?: string;
  /** Stable user id. Changes never. */
  user_id?: string;
  /** The slug used in URLs, e.g. "auronplay". */
  slug?: string;
  username?: string;
  user?: { username?: string; profile_pic?: string; bio?: string };
  profile_pic?: string;
  /** Only present while the channel is live. */
  livestream?: KickLivestream | null;
  is_banned?: boolean;
}

export interface KickLivestream {
  /** Changes per broadcast. Used as the de-duplication key. */
  id?: string;
  session_title?: string;
  is_live?: boolean;
  /** ISO 8601. */
  start_time?: string;
  viewer_count?: number;
  language?: string;
  slug?: string;
}