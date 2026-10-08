import type { KickChannel } from "./types";
import type { StreamInfo } from "@/lib/streams/types";

/**
 * Turn Kick responses into the app's own `StreamInfo` shape.
 *
 * Pure functions with no network access, so the awkward parts of Kick's
 * contract are unit tested:
 *
 *   - A channel response carries `livestream` only while the channel is live,
 *     so "offline" is an absent field rather than a flag.
 *   - `is_live` exists but is not the authority; the field's presence is.
 *   - Kick returns 200 with an error body for a channel that does not exist.
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

/**
 * The channel's profile picture.
 *
 * The field sits at two levels depending on the endpoint version, so both are
 * checked rather than one silently rendering a broken image.
 */
export function pickAvatar(channel: KickChannel): string | null {
  return orNull(channel.profile_pic) ?? orNull(channel.user?.profile_pic);
}

/** The account shape, or null when the response holds no usable channel. */
export function normalizeChannel(channel: KickChannel): {
  providerUserId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
} | null {
  const userId = orNull(channel.user_id);
  const slug = orNull(channel.slug) ?? orNull(channel.username);

  // A channel with neither cannot be queried again, so it is not an account.
  if (!userId || !slug) return null;

  return {
    // The user id is the stable key. The slug can change if the creator
    // renames their channel, which would otherwise break the connection.
    providerUserId: userId,
    username: slug,
    displayName: orNull(channel.username) ?? slug,
    avatarUrl: pickAvatar(channel),
  };
}

/**
 * The live broadcast from a channel response, or null.
 *
 * A `livestream` block is only present while the channel is live. The
 * `is_live` flag is checked too, because relying on presence alone would treat
 * a `livestream` with `is_live: false` as live.
 */
export function normalizeLivestream(
  channel: KickChannel,
  account: { providerUserId: string; username: string; displayName: string | null },
): Omit<StreamInfo, "provider"> | null {
  const livestream = channel.livestream;

  if (!livestream) return null;
  if (livestream.is_live === false) return null;

  const streamId = orNull(livestream.id);

  if (!streamId) return null;

  return {
    creatorId: account.providerUserId,
    creatorUsername: account.username,
    creatorDisplayName: account.displayName,
    // The livestream id changes per broadcast, which is what alert
    // de-duplication needs.
    providerStreamId: streamId,
    title: orNull(livestream.session_title),
    // Kick has no category or game field.
    game: null,
    // Kick's own thumbnail is not part of the public response, so no image is
    // offered rather than a guessed URL that would 404.
    thumbnail: null,
    viewerCount:
      typeof livestream.viewer_count === "number" ? livestream.viewer_count : null,
    url: buildChannelUrl(account.username),
    startedAt: toDate(livestream.start_time),
  };
}