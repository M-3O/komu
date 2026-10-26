import { describe, expect, it } from "vitest";

import {
  buildChannelUrl,
  normalizeChannel,
  normalizeLivestream,
  parseChannelIdentifier,
} from "./normalize";
import type { KickChannel } from "./types";

/**
 * Kick normalisation, using the shapes the public API actually returns.
 *
 * Verified against `GET /public/v1/channels?slug=...`:
 *
 *   - the stable id is `broadcaster_user_id`, a number;
 *   - the login is `slug`, with no separate display name or avatar;
 *   - a `stream` block is always present, and `is_live` says whether it runs;
 *   - there is no per-broadcast id, so `start_time` keys one session.
 */

const ACCOUNT = {
  providerUserId: "676",
  username: "xqc",
  displayName: "xqc",
};

describe("parseChannelIdentifier", () => {
  it("accepts a bare slug", () => {
    expect(parseChannelIdentifier("auronplay")).toBe("auronplay");
  });

  it("lowercases, because Kick slugs are lowercase", () => {
    expect(parseChannelIdentifier("AuronPlay")).toBe("auronplay");
  });

  it("accepts an @-prefixed name", () => {
    expect(parseChannelIdentifier("@auronplay")).toBe("auronplay");
  });

  it("accepts a channel URL", () => {
    expect(parseChannelIdentifier("https://kick.com/auronplay")).toBe("auronplay");
    expect(parseChannelIdentifier("https://www.kick.com/auronplay")).toBe("auronplay");
  });

  it("accepts a URL with a trailing path", () => {
    // Categories and the "?fcp" copy link are what creators actually paste.
    expect(parseChannelIdentifier("https://kick.com/auronplay?fcp")).toBe("auronplay");
  });

  it("returns null for nothing usable", () => {
    expect(parseChannelIdentifier("")).toBeNull();
    expect(parseChannelIdentifier("   ")).toBeNull();
    expect(parseChannelIdentifier("has spaces")).toBeNull();
    expect(parseChannelIdentifier("dash-and-dot")).toBeNull();
  });
});

describe("buildChannelUrl", () => {
  it("builds the channel page", () => {
    expect(buildChannelUrl("auronplay")).toBe("https://kick.com/auronplay");
  });
});

describe("normalizeChannel", () => {
  it("uses the numeric broadcaster id as the stable key", () => {
    // The slug can change if the creator renames the channel, which would
    // otherwise break a stored connection.
    const account = normalizeChannel({
      broadcaster_user_id: 676,
      slug: "xqc",
      channel_description: "THE BEST AT ABSOLUTELY EVERYTHING.",
    });

    expect(account).toEqual({
      providerUserId: "676",
      username: "xqc",
      // Kick returns no display name and no avatar.
      displayName: "xqc",
      avatarUrl: null,
    });
  });

  it("returns null without a broadcaster id, which cannot be queried again", () => {
    expect(normalizeChannel({ slug: "xqc" })).toBeNull();
  });

  it("returns null without a slug", () => {
    expect(normalizeChannel({ broadcaster_user_id: 676 })).toBeNull();
  });

  it("returns null for an empty response", () => {
    expect(normalizeChannel({})).toBeNull();
  });
});

describe("normalizeLivestream", () => {
  const liveChannel = (overrides: Partial<KickChannel> = {}): KickChannel => ({
    broadcaster_user_id: 676,
    slug: "xqc",
    stream_title: "24 Hour Stream ft. Wardrobe",
    category: { id: 15, name: "IRL" },
    stream: {
      is_live: true,
      is_mature: false,
      language: "en",
      start_time: "2026-10-25T22:46:20Z",
      viewer_count: 34248,
      thumbnail: "https://images.kick.com/video_thumbnails/abc/480.webp",
      url: "",
    },
    ...overrides,
  });

  it("normalises a live stream from the real channel payload", () => {
    expect(normalizeLivestream(liveChannel(), ACCOUNT)).toMatchObject({
      creatorId: "676",
      creatorUsername: "xqc",
      creatorDisplayName: "xqc",
      providerStreamId: "2026-10-25T22:46:20.000Z",
      title: "24 Hour Stream ft. Wardrobe",
      game: "IRL",
      thumbnail: "https://images.kick.com/video_thumbnails/abc/480.webp",
      viewerCount: 34248,
      url: "https://kick.com/xqc",
      startedAt: new Date("2026-10-25T22:46:20Z"),
    });
  });

  it("returns null when the stream is offline", () => {
    // The block still exists after a broadcast ends; is_live is the signal.
    const offline = liveChannel({
      stream_title: "",
      category: { id: 0, name: "" },
      stream: {
        is_live: false,
        start_time: "0001-01-01T00:00:00Z",
        viewer_count: 0,
        thumbnail: "",
      },
    });

    expect(normalizeLivestream(offline, ACCOUNT)).toBeNull();
  });

  it("returns null when the stream block is missing", () => {
    expect(normalizeLivestream({ slug: "xqc" }, ACCOUNT)).toBeNull();
  });

  it("returns null when is_live is missing", () => {
    const unknown = liveChannel({
      stream: { start_time: "2026-10-25T22:46:20Z" },
    });

    expect(normalizeLivestream(unknown, ACCOUNT)).toBeNull();
  });

  it("returns null without a start time, because there is no session key", () => {
    const broken = liveChannel({ stream: { is_live: true } });

    expect(normalizeLivestream(broken, ACCOUNT)).toBeNull();
  });

  it("returns null for an unparseable start time", () => {
    const broken = liveChannel({
      stream: { is_live: true, start_time: "yesterday" },
    });

    expect(normalizeLivestream(broken, ACCOUNT)).toBeNull();
  });

  it("returns null for an empty channel", () => {
    expect(normalizeLivestream({}, ACCOUNT)).toBeNull();
  });

  it("uses the account's display name rather than re-reading the channel", () => {
    expect(normalizeLivestream(liveChannel(), ACCOUNT)?.creatorDisplayName).toBe(
      "xqc",
    );
  });

  it("handles a zero viewer count as zero, not unknown", () => {
    const nobody = liveChannel({
      stream: {
        is_live: true,
        start_time: "2026-10-25T22:46:20Z",
        viewer_count: 0,
      },
    });

    expect(normalizeLivestream(nobody, ACCOUNT)?.viewerCount).toBe(0);
  });

  it("treats a non-numeric viewer count as unknown", () => {
    const odd = liveChannel({
      stream: {
        is_live: true,
        start_time: "2026-10-25T22:46:20Z",
        viewer_count: "loads" as unknown as number,
      },
    });

    expect(normalizeLivestream(odd, ACCOUNT)?.viewerCount).toBeNull();
  });

  it("treats missing optional fields as null", () => {
    const sparse = liveChannel({
      stream_title: undefined,
      category: undefined,
      stream: { is_live: true, start_time: "2026-10-25T22:46:20Z" },
    });
    const result = normalizeLivestream(sparse, ACCOUNT);

    expect(result?.title).toBeNull();
    expect(result?.game).toBeNull();
    expect(result?.thumbnail).toBeNull();
    expect(result?.viewerCount).toBeNull();
  });

  it("trims empty strings rather than showing blank fields", () => {
    const blank = liveChannel({
      stream_title: "   ",
      category: { name: "  " },
      stream: {
        is_live: true,
        start_time: "2026-10-25T22:46:20Z",
        thumbnail: " ",
      },
    });
    const result = normalizeLivestream(blank, ACCOUNT);

    expect(result?.title).toBeNull();
    expect(result?.game).toBeNull();
    expect(result?.thumbnail).toBeNull();
  });
});
