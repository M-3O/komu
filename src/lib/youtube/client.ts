import "server-only";

import { createLogger } from "@/lib/logger";
import type {
  YouTubeChannelItem,
  YouTubeListResponse,
  YouTubeSearchItem,
  YouTubeVideoItem,
} from "./types";

/**
 * Thin YouTube Data API v3 client.
 *
 * Authenticated with an API key rather than an OAuth token: asking whether a
 * channel is live is public information, so the creator never has to grant
 * Komu access to their Google account.
 *
 * Quota cost is the thing to understand here. YouTube charges per request out
 * of a daily allowance, and `search.list` costs **100 units** while
 * `channels.list` and `videos.list` cost 1. The default daily allowance is
 * 10,000, so a 60-second poll of a YouTube channel would exhaust it in under
 * two hours. See README "YouTube quota" before choosing a poll interval.
 */

const API_BASE = "https://www.googleapis.com/youtube/v3";

/** `search.list` is expensive; everything else here is cheap. */
export const SEARCH_QUOTA_COST = 100;
export const CHEAP_QUOTA_COST = 1;

const RATE_LIMIT_STATUS = 429;
const QUOTA_STATUS = 403;

const log = createLogger("stream");

/** Thrown when YouTube cannot be reached or refuses the request. */
export class YouTubeApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "YouTubeApiError";
  }
}

function getApiKey(): string {
  // The client id doubles as the API key: Google issues both together, and the
  // key is what the Data API authenticates with.
  const key = process.env.YOUTUBE_CLIENT_ID;

  if (!key) {
    throw new YouTubeApiError(
      "YouTube is not configured. Add YOUTUBE_CLIENT_ID to .env.local.",
      undefined,
      "NOT_CONFIGURED",
    );
  }

  return key;
}

/** Perform a request and return its `items` array. */
async function apiGet<T>(
  path: string,
  params: Record<string, string>,
): Promise<T[]> {
  const key = getApiKey();

  const search = new URLSearchParams({ ...params, key });

  const response = await fetch(`${API_BASE}${path}?${search}`, {
    // Live status changes constantly; never serve a stale copy.
    cache: "no-store",
  });

  if (!response.ok) {
    if (response.status === RATE_LIMIT_STATUS) {
      log.warn("YouTube rate limit hit", { path });
      throw new YouTubeApiError(
        "YouTube is rate limiting requests. Try again shortly.",
        response.status,
        "RATE_LIMITED",
      );
    }

    // 403 is how the API reports a spent quota, or an API not enabled on the
    // project. Both are configuration problems the creator can fix.
    if (response.status === QUOTA_STATUS) {
      log.error("YouTube refused a request", { path, status: response.status });
      throw new YouTubeApiError(
        "YouTube refused the request. Check that the YouTube Data API is enabled and the daily quota is not spent.",
        response.status,
        "QUOTA_OR_API_DISABLED",
      );
    }

    log.error("YouTube request failed", { path, status: response.status });

    throw new YouTubeApiError(
      "YouTube could not be reached.",
      response.status,
      "REQUEST_FAILED",
    );
  }

  const body = (await response.json()) as YouTubeListResponse<T>;

  if (body?.error) {
    log.error("YouTube returned an error body", {
      path,
      reason: body.error.errors?.[0]?.reason,
    });

    throw new YouTubeApiError("YouTube could not be reached.", response.status, "API_ERROR");
  }

  return Array.isArray(body?.items) ? body.items : [];
}

/** Look up a channel by its id. One quota unit. */
export function getChannelById(channelId: string): Promise<YouTubeChannelItem[]> {
  return apiGet<YouTubeChannelItem>("/channels", { part: "snippet", id: channelId });
}

/** Look up a channel by its `@handle`. One quota unit. */
export function getChannelByHandle(handle: string): Promise<YouTubeChannelItem[]> {
  // The API wants the handle without the @.
  const bare = handle.replace(/^@/, "");

  return apiGet<YouTubeChannelItem>("/channels", {
    part: "snippet",
    forHandle: bare,
  });
}

/**
 * The channel's current live video, or an empty array when offline.
 *
 * **100 quota units.** This is the expensive call, and the reason the README
 * warns against a short poll interval.
 */
export function getLiveVideo(channelId: string): Promise<YouTubeSearchItem[]> {
  return apiGet<YouTubeSearchItem>("/search", {
    part: "snippet",
    channelId,
    // Only currently-live broadcasts. Without this the search returns recent
    // uploads as well, which would alert on every video.
    eventType: "live",
    type: "video",
    // One result is enough: a channel has at most one live broadcast.
    maxResults: "1",
  });
}

/** Full details for a video. One quota unit. */
export function getVideo(videoId: string): Promise<YouTubeVideoItem[]> {
  return apiGet<YouTubeVideoItem>("/videos", {
    // `liveStreamingDetails` is the part that says whether it is running.
    part: "snippet,liveStreamingDetails",
    id: videoId,
  });
}