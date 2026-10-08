import type {
  YouTubeChannelItem,
  YouTubeSearchItem,
  YouTubeThumbnails,
  YouTubeVideoItem,
} from "./types";
import type { StreamInfo } from "@/lib/streams/types";

/**
 * Turn YouTube responses into the app's own `StreamInfo` shape.
 *
 * Pure functions with no network access, so the awkward parts of the contract
 * are unit tested rather than discovered in production:
 *
 *   - Titles arrive HTML-escaped (`&amp;`, `&#39;`) and must be decoded, or a
 *     creator's "Bob's Stream" posts as "Bob&#39;s Stream" in Discord.
 *   - The thumbnail map is ordered smallest-first, and `maxres` is often
 *     absent for small channels, so picking blindly yields a 120px image.
 *   - `liveStreamingDetails` is present for any video that was or is a
 *     broadcast, so its presence alone does not mean "live" right now.
 *   - `concurrentViewers` is a string, not a number.
 */

const YOUTUBE_WATCH = "https://www.youtube.com/watch?v=";

/** A YouTube channel id is `UC` followed by 22 characters. */
const CHANNEL_ID = /^UC[\w-]{22}$/;

/** Whether an identifier looks like a full channel id rather than a handle. */
export function isChannelId(identifier: string): boolean {
  return CHANNEL_ID.test(identifier.trim());
}

/**
 * Pull a channel id or handle out of whatever the creator pasted.
 *
 * Accepts a raw id, a handle with or without the `@`, and any of the URL forms
 * YouTube uses. Returns null when nothing recognisable is there, so the caller
 * can say so rather than sending a nonsense query.
 */
export function parseChannelIdentifier(raw: string): string | null {
  const trimmed = raw.trim();

  if (!trimmed) return null;

  // A bare id.
  if (isChannelId(trimmed)) return trimmed;

  // A handle, with or without the @.
  if (/^@[\w.-]+$/.test(trimmed)) return trimmed;

  // A URL of any shape. Pull the channel id or the handle out of the path.
  const channelId = trimmed.match(/\/channel\/(UC[\w-]{22})/);
  if (channelId) return channelId[1];

  const handle = trimmed.match(/\/@([\w.-]+)/);
  if (handle) return `@${handle[1]}`;

  // Legacy vanity paths: /c/name, /user/name, /u/name, with an optional id
  // query the creator often copies from the address bar.
  const vanity = trimmed.match(/\/(?:c|user|u)\/([\w.-]+)/);
  if (vanity) return `@${vanity[1]}`;

  // A bare word is treated as a handle, which is what creators usually mean.
  return /^[\w.-]+$/.test(trimmed) ? `@${trimmed}` : null;
}

/**
 * Decode YouTube's HTML-escaped title.
 *
 * The API escapes `&`, `'`, `"` and `<` in titles. Only the entities YouTube
 * actually emits are handled, and unknown entities are left alone rather than
 * mangled.
 */
export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** Trimmed non-empty string, or null. */
function orNull(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;

  const trimmed = value.trim();

  return trimmed.length === 0 ? null : trimmed;
}

/** Parse an RFC3339 timestamp, returning null rather than an Invalid Date. */
function toDate(value: string | undefined): Date | null {
  if (!value) return null;

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Pick the largest available thumbnail.
 *
 * `maxres` is best but is only generated for high-resolution uploads, so the
 * list is walked largest-first rather than picked by a fixed key.
 */
export function pickThumbnail(thumbnails: YouTubeThumbnails | undefined): string | null {
  if (!thumbnails) return null;

  const ordered = [
    thumbnails.maxres,
    thumbnails.standard,
    thumbnails.high,
    thumbnails.medium,
    thumbnails.default,
  ];

  for (const thumbnail of ordered) {
    const url = orNull(thumbnail?.url);
    if (url) return url;
  }

  return null;
}

/** Normalise a `channels` response into the account shape. */
export function normalizeChannel(
  item: YouTubeChannelItem,
): { providerUserId: string; username: string; displayName: string | null; avatarUrl: string | null } | null {
  const id = orNull(item.id);

  if (!id) return null;

  const title = orNull(item.snippet?.title);

  return {
    providerUserId: id,
    // YouTube has no separate login handle on the channels endpoint, so the
    // channel id stands in as the username. It is what the API needs to query
    // live status anyway.
    username: id,
    displayName: title ? decodeHtmlEntities(title) : null,
    avatarUrl: pickThumbnail(item.snippet?.thumbnails),
  };
}

/** The public watch page for a video. */
export function buildWatchUrl(videoId: string): string {
  return `${YOUTUBE_WATCH}${videoId}`;
}

/** The public channel page. */
export function buildChannelUrl(channelId: string): string {
  return `https://www.youtube.com/channel/${channelId}`;
}

/**
 * The live video id from a `search` response, or null.
 *
 * The `eventType=live` filter is applied server-side, so anything returned
 * should be a live stream. The videoId is still checked rather than trusted,
 * because an unexpected item should not become an alert with a broken link.
 */
export function pickLiveVideoId(items: YouTubeSearchItem[]): string | null {
  for (const item of items) {
    const videoId = orNull(item.id?.videoId);

    if (videoId) return videoId;
  }

  return null;
}

/**
 * Build a `StreamInfo` from a `videos` response.
 *
 * Returns null when the video is not currently live. YouTube keeps
 * `liveStreamingDetails` on a broadcast after it ends, so the presence of that
 * block is not enough: an `actualEndTime` means the broadcast finished.
 */
export function normalizeLiveStream(
  video: YouTubeVideoItem,
): Omit<StreamInfo, "provider"> | null {
  const videoId = orNull(video.id);

  if (!videoId) return null;

  const details = video.liveStreamingDetails;

  // No broadcast block at all: an ordinary video, so not live.
  if (!details) return null;

  // A broadcast that has already ended. This is the case that most needs
  // handling, because the block is still present.
  if (details.actualEndTime) return null;

  const startedAt = toDate(details.actualStartTime);

  // An actual start is the signal that a broadcast is running. Without it there
  // is no live session to alert on.
  if (!startedAt) return null;

  const channelId = orNull(video.snippet?.channelId);

  const viewers = Number.parseInt(details.concurrentViewers ?? "", 10);

  return {
    creatorId: channelId ?? "unknown",
    creatorUsername: channelId ?? "unknown",
    creatorDisplayName: video.snippet?.channelTitle
      ? decodeHtmlEntities(video.snippet.channelTitle)
      : null,
    // The video id changes when a new broadcast starts and stays stable within
    // one, which is exactly what alert de-duplication needs.
    providerStreamId: videoId,
    title: video.snippet?.title ? decodeHtmlEntities(video.snippet.title) : null,
    // YouTube has no category or game for a live stream.
    game: null,
    thumbnail: pickThumbnail(video.snippet?.thumbnails),
    viewerCount: Number.isFinite(viewers) ? viewers : null,
    url: buildWatchUrl(videoId),
    startedAt,
  };
}