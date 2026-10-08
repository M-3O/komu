/**
 * Raw YouTube Data API v3 response shapes.
 *
 * Only the fields Komu reads. Every one is nullable or optional in practice,
 * which is why nothing downstream assumes a value is present.
 */

/** The `items` shape shared by the endpoints used here. */
export interface YouTubeListResponse<T> {
  items?: T[];
  pageInfo?: { totalResults?: number; resultsPerPage?: number };
  /** Present on quota and auth failures. */
  error?: { code?: number; message?: string; errors?: Array<{ reason?: string }> };
}

export interface YouTubeChannelItem {
  id?: string;
  snippet?: {
    title?: string;
    customUrl?: string;
    publishedAt?: string;
    thumbnails?: YouTubeThumbnails;
  };
}

export interface YouTubeThumbnails {
  default?: YouTubeThumbnail;
  medium?: YouTubeThumbnail;
  high?: YouTubeThumbnail;
  standard?: YouTubeThumbnail;
  maxres?: YouTubeThumbnail;
}

export interface YouTubeThumbnail {
  url?: string;
  width?: number;
  height?: number;
}

export interface YouTubeSearchItem {
  id?: { kind?: string; videoId?: string };
  snippet?: {
    title?: string;
    channelId?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: YouTubeThumbnails;
  };
}

export interface YouTubeVideoItem {
  id?: string;
  snippet?: {
    title?: string;
    channelId?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: YouTubeThumbnails;
  };
  liveStreamingDetails?: {
    /** Present only while a broadcast is running. */
    actualStartTime?: string;
    actualEndTime?: string;
    concurrentViewers?: string;
    activeLiveChatId?: string;
  };
}