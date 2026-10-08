import { describe, expect, it } from "vitest";

import {
  buildWatchUrl,
  decodeHtmlEntities,
  isChannelId,
  normalizeChannel,
  normalizeLiveStream,
  parseChannelIdentifier,
  pickLiveVideoId,
  pickThumbnail,
} from "./normalize";
import type { YouTubeSearchItem, YouTubeVideoItem } from "./types";

/**
 * YouTube normalisation.
 *
 * Every case here is something that fails silently in production: a title
 * posted as `Bob&#39;s Stream`, a 120px thumbnail, or an alert firing for a
 * broadcast that finished an hour ago.
 */

const CHANNEL_ID = "UCf8w5m0YsRa8MHQ5bwSGmbw";

describe("isChannelId", () => {
  it("accepts a full channel id", () => {
    expect(isChannelId(CHANNEL_ID)).toBe(true);
  });

  it("rejects a handle", () => {
    expect(isChannelId("@auronplay")).toBe(false);
    expect(isChannelId("auronplay")).toBe(false);
  });

  it("rejects an id of the wrong shape", () => {
    expect(isChannelId("UCtooshort")).toBe(false);
    expect(isChannelId("XXf8w5m0YsRa8MHQ5bwSGmbw")).toBe(false);
    expect(isChannelId("")).toBe(false);
  });
});

describe("parseChannelIdentifier", () => {
  it("accepts a bare channel id", () => {
    expect(parseChannelIdentifier(CHANNEL_ID)).toBe(CHANNEL_ID);
  });

  it("accepts a handle with or without the @", () => {
    expect(parseChannelIdentifier("@auronplay")).toBe("@auronplay");
    expect(parseChannelIdentifier("auronplay")).toBe("@auronplay");
  });

  it("accepts a channel URL", () => {
    expect(parseChannelIdentifier(`https://www.youtube.com/channel/${CHANNEL_ID}`)).toBe(
      CHANNEL_ID,
    );
  });

  it("accepts a handle URL", () => {
    expect(parseChannelIdentifier("https://www.youtube.com/@auronplay")).toBe(
      "@auronplay",
    );
  });

  it("accepts a watch URL and finds the channel", () => {
    // Creators paste whatever is in their address bar.
    expect(
      parseChannelIdentifier(`https://www.youtube.com/watch?v=abc123&t=42s`),
    ).toBeNull();
  });

  it("accepts a legacy vanity URL", () => {
    expect(parseChannelIdentifier("https://www.youtube.com/c/auronplay")).toBe(
      "@auronplay",
    );
    expect(parseChannelIdentifier("https://www.youtube.com/user/auronplay")).toBe(
      "@auronplay",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(parseChannelIdentifier(`  ${CHANNEL_ID}  `)).toBe(CHANNEL_ID);
  });

  it("returns null for nothing usable", () => {
    expect(parseChannelIdentifier("")).toBeNull();
    expect(parseChannelIdentifier("   ")).toBeNull();
    expect(parseChannelIdentifier("not a channel!!")).toBeNull();
  });
});

describe("decodeHtmlEntities", () => {
  it("decodes an apostrophe, which is the common case", () => {
    // Without this, "Bob's Stream" posts to Discord as "Bob&#39;s Stream".
    expect(decodeHtmlEntities("Bob&#39;s Stream")).toBe("Bob's Stream");
    expect(decodeHtmlEntities("Bob&apos;s Stream")).toBe("Bob's Stream");
    expect(decodeHtmlEntities("Bob&#x27;s Stream")).toBe("Bob's Stream");
  });

  it("decodes ampersands last so entities are not double-decoded", () => {
    // Decoding &amp; first would turn "&amp;lt;" into "<".
    expect(decodeHtmlEntities("Tom &amp; Jerry")).toBe("Tom & Jerry");
    expect(decodeHtmlEntities("&amp;lt;")).toBe("&lt;");
  });

  it("decodes the other entities YouTube emits", () => {
    expect(decodeHtmlEntities("&quot;quoted&quot;")).toBe('"quoted"');
    expect(decodeHtmlEntities("a &lt; b &gt; c")).toBe("a < b > c");
    expect(decodeHtmlEntities("a&nbsp;b")).toBe("a b");
  });

  it("decodes numeric references", () => {
    expect(decodeHtmlEntities("caf&#233;")).toBe("café");
  });

  it("leaves unknown entities alone", () => {
    expect(decodeHtmlEntities("&notreal;")).toBe("&notreal;");
  });

  it("leaves ordinary text untouched", () => {
    expect(decodeHtmlEntities("Just a normal title")).toBe("Just a normal title");
  });
});

describe("pickThumbnail", () => {
  it("prefers maxres", () => {
    const url = pickThumbnail({
      default: { url: "d.jpg" },
      maxres: { url: "x.jpg" },
    });

    expect(url).toBe("x.jpg");
  });

  it("falls back when maxres is absent", () => {
    // YouTube only generates maxres for high-resolution uploads, so a fixed
    // key would hand a 120px image for most channels.
    expect(pickThumbnail({ default: { url: "d.jpg" }, high: { url: "h.jpg" } })).toBe(
      "h.jpg",
    );
  });

  it("falls back all the way to default", () => {
    expect(pickThumbnail({ default: { url: "d.jpg" } })).toBe("d.jpg");
  });

  it("skips an entry with no url", () => {
    expect(pickThumbnail({ maxres: {}, high: { url: "h.jpg" } })).toBe("h.jpg");
  });

  it("returns null when there is nothing to pick", () => {
    expect(pickThumbnail(undefined)).toBeNull();
    expect(pickThumbnail({})).toBeNull();
  });
});

describe("normalizeChannel", () => {
  it("reads the account fields", () => {
    const account = normalizeChannel({
      id: CHANNEL_ID,
      snippet: {
        title: "Auron Plays",
        thumbnails: { medium: { url: "a.jpg" } },
      },
    });

    expect(account).toEqual({
      providerUserId: CHANNEL_ID,
      username: CHANNEL_ID,
      displayName: "Auron Plays",
      avatarUrl: "a.jpg",
    });
  });

  it("decodes an escaped channel title", () => {
    const account = normalizeChannel({ id: CHANNEL_ID, snippet: { title: "Bob&#39;s" } });
    expect(account?.displayName).toBe("Bob's");
  });

  it("returns null without an id, which cannot be queried again", () => {
    expect(normalizeChannel({ snippet: { title: "No Id" } })).toBeNull();
    expect(normalizeChannel({})).toBeNull();
  });

  it("survives an empty response", () => {
    expect(normalizeChannel({})).toBeNull();
  });
});

describe("pickLiveVideoId", () => {
  it("finds the video id", () => {
    const items: YouTubeSearchItem[] = [{ id: { videoId: "abc123" } }];
    expect(pickLiveVideoId(items)).toBe("abc123");
  });

  it("returns null when the channel is offline", () => {
    expect(pickLiveVideoId([])).toBeNull();
  });

  it("skips an entry with no video id", () => {
    // A playlist or channel item would break the watch URL if trusted.
    const items: YouTubeSearchItem[] = [{ id: { kind: "youtube#channel" } }, { id: { videoId: "ok" } }];
    expect(pickLiveVideoId(items)).toBe("ok");
  });
});

describe("buildWatchUrl", () => {
  it("builds the watch page", () => {
    expect(buildWatchUrl("abc123")).toBe("https://www.youtube.com/watch?v=abc123");
  });
});

describe("normalizeLiveStream", () => {
  const liveVideo = (overrides: Partial<YouTubeVideoItem> = {}): YouTubeVideoItem => ({
    id: "abc123",
    snippet: {
      title: "Bob&#39;s stream",
      channelId: CHANNEL_ID,
      channelTitle: "Auron Plays",
      thumbnails: { high: { url: "h.jpg" } },
    },
    liveStreamingDetails: {
      actualStartTime: "2024-05-17T10:00:00Z",
      concurrentViewers: "1234",
    },
    ...overrides,
  });

  it("normalises a live stream", () => {
    const result = normalizeLiveStream(liveVideo());

    expect(result).toMatchObject({
      creatorId: CHANNEL_ID,
      providerStreamId: "abc123",
      title: "Bob's stream",
      viewerCount: 1234,
      startedAt: new Date("2024-05-17T10:00:00Z"),
    });
  });

  it("has no game, because YouTube does not report one", () => {
    expect(normalizeLiveStream(liveVideo())?.game).toBeNull();
  });

  it("returns null for a finished broadcast", () => {
    // The important case: YouTube keeps liveStreamingDetails after a
    // broadcast ends, so presence alone would alert for every past stream.
    const finished = liveVideo({
      liveStreamingDetails: {
        actualStartTime: "2024-05-17T10:00:00Z",
        actualEndTime: "2024-05-17T12:00:00Z",
      },
    });

    expect(normalizeLiveStream(finished)).toBeNull();
  });

  it("returns null for an ordinary video with no broadcast block", () => {
    expect(normalizeLiveStream({ id: "abc", snippet: { title: "A video" } })).toBeNull();
  });

  it("returns null when there is no start time", () => {
    const noStart = liveVideo({ liveStreamingDetails: { concurrentViewers: "5" } });
    expect(normalizeLiveStream(noStart)).toBeNull();
  });

  it("returns null for an empty response", () => {
    expect(normalizeLiveStream({})).toBeNull();
  });

  it("treats a non-numeric viewer count as unknown", () => {
    const odd = liveVideo({
      liveStreamingDetails: { actualStartTime: "2024-05-17T10:00:00Z", concurrentViewers: "many" },
    });

    expect(normalizeLiveStream(odd)?.viewerCount).toBeNull();
  });

  it("handles a missing viewer count", () => {
    expect(normalizeLiveStream(liveVideo())?.viewerCount).toBe(1234);
  });

  it("handles a zero viewer count as zero, not unknown", () => {
    const nobody = liveVideo({
      liveStreamingDetails: { actualStartTime: "2024-05-17T10:00:00Z", concurrentViewers: "0" },
    });

    expect(normalizeLiveStream(nobody)?.viewerCount).toBe(0);
  });

  it("ignores an unparseable start time rather than storing Invalid Date", () => {
    const broken = liveVideo({
      liveStreamingDetails: { actualStartTime: "not a date" },
    });

    expect(normalizeLiveStream(broken)).toBeNull();
  });
});