import type { KickChannel } from "./types";
import type { StreamInfo } from "@/lib/streams/types";

/**
 * Turn Kick responses into the app's own `StreamInfo` shape.
 *
 * Pure functions with no network access, so the awkward parts of Kick's
 * contract are unit tested:
 *
 *   - A channel response always carries a `stream` block. `is_live` is the
 *     authority; the block's presence is not, because it stays after the
 *     broadcast ends.
 *   - Kick exposes no per-broadcast id, so the stream's start time identifies
 *     one session.
 *   - A missing channel is an empty `data` array, not an HTTP error.
 */

const KICK_BASE = "https://kick.com";

/** Kick slugs are lowercase letters, digits and underscores. */
const SLUG = /^[a-z0-9_]+$/;

/**
 * Pull a slug out of whatever the creator pasted.
 *
 * Accepts a bare slug, a @-prefixed name, and any kick.com URL. Returns null
 * when nothing recognisable is there, rather than sending a request that will
 * certainly fail.
 */
export function parseChannelIdentifier(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();

  if (!trimmed) return null;

  // Any URL with the slug in the path.
  const fromUrl = trimmed.match(/kick\.com\/(?:[^/]+\/)?([a-z0-9_]+)/);

  if (fromUrl) return fromUrl[1];

  const bare = trimmed.replace(/^@/, "");

  return SLUG.test(bare) ? bare : null;
}

/** Trimmed non-empty string, or null. */
function orNull(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;

  const trimmed = value.trim();

  return trimmed.length === 0 ? null : trimmed;
}

/** Parse an ISO 8601 timestamp, returning null rather than an Invalid Date. */
function toDate(value: string | undefined): Date | null {
  if (!value) return null;

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** The public channel page. */
export function buildChannelUrl(slug: string): string {
  return `${KICK_BASE}/${slug}`;
}

/** The account shape, or null when the response holds no usable channel. */
export function normalizeChannel(channel: KickChannel): {
  providerUserId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
} | null {
  const userId =
    typeof channel.broadcaster_user_id === "number"
      ? String(channel.broadcaster_user_id)
      : null;
  const slug = orNull(channel.slug);

  // A channel with neither cannot be queried again, so it is not an account.
  if (!userId || !slug) return null;

  return {
    // The broadcaster id is the stable key. The slug can change if the creator
    // renames their channel, which would otherwise break the connection.
    providerUserId: userId,
    username: slug,
    // Kick's channel response has no display name separate from the slug, and
    // `banner_picture` is a banner rather than an avatar. Use the slug and no
    // image instead of showing something wrong.
    displayName: slug,
    avatarUrl: null,
  };
}

/**
 * The live broadcast from a channel response, or null.
 *
 * `is_live` is checked explicitly: the `stream` block is present while a
 * channel is offline, so treating presence as "live" would alert forever.
 */
export function normalizeLivestream(
  channel: KickChannel,
  account: {
    providerUserId: string;
    username: string;
    displayName: string | null;
  },
): Omit<StreamInfo, "provider"> | null {
  const stream = channel.stream;

  if (!stream || stream.is_live !== true) return null;

  const startedAt = toDate(stream.start_time);

  // With no start time there is no stable key for this broadcast, and using a
  // constant would collapse every stream into the first alert. Skipping is
  // safer than alerting on every poll.
  if (!startedAt) return null;

  return {
    creatorId: account.providerUserId,
    creatorUsername: account.username,
    creatorDisplayName: account.displayName,
    // The start time changes per broadcast, which is what alert de-duplication
    // needs, and stays fixed for the whole broadcast.
    providerStreamId: startedAt.toISOString(),
    title: orNull(channel.stream_title),
    game: orNull(channel.category?.name),
    thumbnail: orNull(stream.thumbnail),
    viewerCount:
      typeof stream.viewer_count === "number" &&
      Number.isFinite(stream.viewer_count)
        ? stream.viewer_count
        : null,
    url: buildChannelUrl(account.username),
    startedAt,
  };
}
