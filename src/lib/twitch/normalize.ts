import type { TwitchStreamInfo, TwitchStreamResponse } from "./types";

/**
 * Turn Twitch responses into the app's own `StreamInfo` shape.
 *
 * Pure functions with no network access, so the awkward parts of the Twitch
 * contract are unit tested rather than discovered in production:
 *
 *   - `thumbnail_url` ships `{width}x{height}` placeholders that must be
 *     substituted, or the image 404s.
 *   - `game_name`, `title` and `profile_image_url` are empty strings rather
 *     than null when unset, which would render as blank UI.
 *   - `started_at` is a string and must become a Date.
 */

/** Size used when filling in the thumbnail template. */
export const THUMBNAIL_SIZE = 1280;

/**
 * Twitch returns a URL template like
 * `.../live_user_auronplay-{width}x{height}.jpg`.
 * Substitute the size to get a usable URL.
 */
export function resolveThumbnailUrl(
  template: string,
  size: number = THUMBNAIL_SIZE,
): string | null {
  if (!template) return null;

  const resolved = template
    .replace("{width}", String(size))
    .replace("{height}", String(size))
    // Twitch also uses a doubled-percent form in some responses.
    .replace("%{width}", String(size))
    .replace("%{height}", String(size));

  // If the placeholders are still present the URL is unusable.
  return resolved.includes("{") ? null : resolved;
}

/** Twitch sends "" for an unset value; the app uses null. */
function orNull(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Parse an RFC3339 timestamp, returning null rather than an Invalid Date. */
function toDate(value: string): Date | null {
  if (!value) return null;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** The public watch page for a channel. */
export function buildChannelUrl(login: string): string {
  return `https://www.twitch.tv/${login}`;
}

/**
 * Normalise one stream entry.
 *
 * Returns null when the entry does not describe a live stream, so callers
 * can map over a response without filtering.
 */
export function normalizeTwitchStream(
  stream: TwitchStreamResponse,
): TwitchStreamInfo | null {
  // Twitch sets `type` to "" when it cannot report the stream type, and the
  // docs say that indicates something went wrong. Treat it as not live.
  if (stream.type !== "live") return null;
  if (!stream.id || !stream.user_id) return null;

  return {
    creatorId: stream.user_id,
    creatorUsername: stream.user_login,
    creatorDisplayName: orNull(stream.user_name),
    providerStreamId: stream.id,
    title: orNull(stream.title),
    game: orNull(stream.game_name),
    thumbnail: resolveThumbnailUrl(stream.thumbnail_url),
    viewerCount: typeof stream.viewer_count === "number" ? stream.viewer_count : null,
    url: buildChannelUrl(stream.user_login),
    startedAt: toDate(stream.started_at),
  };
}

/**
 * Pick out the creator's stream from a `/streams` response.
 *
 * Twitch filters server-side by login or id, but returns an empty array when
 * the creator is offline. A response that somehow contains another channel is
 * discarded rather than reported as this creator's stream.
 */
export function pickLiveStream(
  data: TwitchStreamResponse[],
  creatorId: string,
): TwitchStreamInfo | null {
  const match = data.find((entry) => entry.user_id === creatorId);
  if (!match) return null;

  return normalizeTwitchStream(match);
}