import type { StreamInfo } from "../streams/types";

/**
 * Twitch response shapes, typed to what the Helix API actually returns.
 *
 * https://dev.twitch.tv/docs/api/reference#get-streams
 * https://dev.twitch.tv/docs/api/reference#get-users
 *
 * These types exist only so `normalize.ts` has something to read. Nothing
 * outside the Twitch module imports them.
 */

/** A stream entry from `GET /helix/streams`. */
export interface TwitchStreamResponse {
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  /** Empty string when the channel has no category set. */
  game_id: string;
  /** Empty string when the channel has no category set. */
  game_name: string;
  /** "live", or empty string if Twitch reports an error on this field. */
  type: string;
  /** Empty string if the creator set no title. */
  title: string;
  tags?: string[] | null;
  viewer_count: number;
  /** RFC3339. */
  started_at: string;
  language: string;
  /** Contains `{width}x{height}` placeholders that must be replaced. */
  thumbnail_url: string;
}

/** A user entry from `GET /helix/users`. */
export interface TwitchUserResponse {
  id: string;
  login: string;
  display_name: string;
  type: string;
  /** "affiliate", "partner", or "" for a normal broadcaster. */
  broadcaster_type: string;
  description: string;
  /** Empty string when the user set no image. */
  profile_image_url: string;
  /** Empty string when the user set no image. */
  offline_image_url: string;
}

/** Both Helix endpoints wrap their payload in `data`. */
export interface TwitchListResponse<T> {
  data: T[];
  pagination?: { cursor?: string };
}

/** A stream already normalised, with the provider filled in. */
export type TwitchStreamInfo = Omit<StreamInfo, "provider">;