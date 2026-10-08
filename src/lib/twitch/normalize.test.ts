import { describe, expect, it } from "vitest";

import {
  buildChannelUrl,
  normalizeTwitchStream,
  pickLiveStream,
  resolveThumbnailUrl,
  THUMBNAIL_SIZE,
} from "./normalize";
import type { TwitchStreamResponse } from "./types";

/** A realistic live stream entry, matching the Helix example response. */
function liveStream(
  overrides: Partial<TwitchStreamResponse> = {},
): TwitchStreamResponse {
  return {
    id: "123456789",
    user_id: "98765",
    user_login: "sandysanderman",
    user_name: "SandySanderman",
    game_id: "494131",
    game_name: "Little Nightmares",
    type: "live",
    title: "hablamos y le damos a Little Nightmares 1",
    tags: ["Español"],
    viewer_count: 78365,
    started_at: "2021-03-10T15:04:21Z",
    language: "es",
    thumbnail_url:
      "https://static-cdn.jtvnw.net/previews-ttv/live_user_auronplay-{width}x{height}.jpg",
    ...overrides,
  };
}

describe("resolveThumbnailUrl", () => {
  it("replaces the size placeholders", () => {
    const url = resolveThumbnailUrl(
      "https://cdn.example/live_user_x-{width}x{height}.jpg",
    );

    expect(url).toBe(
      `https://cdn.example/live_user_x-${THUMBNAIL_SIZE}x${THUMBNAIL_SIZE}.jpg`,
    );
  });

  it("accepts a specific size", () => {
    expect(resolveThumbnailUrl("https://cdn.example/{width}x{height}.jpg", 320)).toBe(
      "https://cdn.example/320x320.jpg",
    );
  });

  it("returns null for an empty template", () => {
    expect(resolveThumbnailUrl("")).toBeNull();
  });

  it("returns null when placeholders remain", () => {
    // A URL still containing "{" would 404, so it is treated as missing.
    expect(resolveThumbnailUrl("https://cdn.example/{unknown}.jpg")).toBeNull();
  });

  it("leaves an already-resolved URL alone", () => {
    const resolved = "https://cdn.example/live_user_x-1280x1280.jpg";
    expect(resolveThumbnailUrl(resolved)).toBe(resolved);
  });
});

describe("buildChannelUrl", () => {
  it("builds the watch page", () => {
    expect(buildChannelUrl("sandy")).toBe("https://www.twitch.tv/sandy");
  });
});

describe("normalizeTwitchStream", () => {
  it("normalises a live stream", () => {
    const result = normalizeTwitchStream(liveStream());

    expect(result).not.toBeNull();
    expect(result?.creatorId).toBe("98765");
    expect(result?.creatorUsername).toBe("sandysanderman");
    expect(result?.providerStreamId).toBe("123456789");
    expect(result?.title).toBe("hablamos y le damos a Little Nightmares 1");
    expect(result?.game).toBe("Little Nightmares");
    expect(result?.viewerCount).toBe(78365);
    expect(result?.url).toBe("https://www.twitch.tv/sandysanderman");
    expect(result?.startedAt?.toISOString()).toBe("2021-03-10T15:04:21.000Z");
  });

  it("resolves the thumbnail", () => {
    expect(normalizeTwitchStream(liveStream())?.thumbnail).toContain(
      `${THUMBNAIL_SIZE}x${THUMBNAIL_SIZE}`,
    );
  });

  it("returns null when the stream is not live", () => {
    // Twitch sends an empty type when it cannot report the stream state.
    expect(normalizeTwitchStream(liveStream({ type: "" }))).toBeNull();
    expect(normalizeTwitchStream(liveStream({ type: "archive" }))).toBeNull();
  });

  it("converts empty strings to null", () => {
    const result = normalizeTwitchStream(
      liveStream({ title: "", game_name: "", game_id: "" }),
    );

    expect(result?.title).toBeNull();
    expect(result?.game).toBeNull();
  });

  it("treats whitespace-only strings as unset", () => {
    expect(normalizeTwitchStream(liveStream({ title: "   " }))?.title).toBeNull();
  });

  it("returns null for an unparseable start time", () => {
    expect(
      normalizeTwitchStream(liveStream({ started_at: "not-a-date" }))?.startedAt,
    ).toBeNull();
  });

  it("returns null for an empty start time", () => {
    expect(
      normalizeTwitchStream(liveStream({ started_at: "" }))?.startedAt,
    ).toBeNull();
  });

  it("handles zero viewers", () => {
    // Zero is a real viewer count, not missing data.
    expect(normalizeTwitchStream(liveStream({ viewer_count: 0 }))?.viewerCount).toBe(0);
  });

  it("returns null when required identifiers are missing", () => {
    expect(normalizeTwitchStream(liveStream({ id: "" }))).toBeNull();
    expect(normalizeTwitchStream(liveStream({ user_id: "" }))).toBeNull();
  });
});

describe("pickLiveStream", () => {
  it("returns null when the creator is offline", () => {
    // Twitch omits offline channels from the response entirely.
    expect(pickLiveStream([], "98765")).toBeNull();
  });

  it("finds the creator's stream", () => {
    const result = pickLiveStream([liveStream()], "98765");
    expect(result?.providerStreamId).toBe("123456789");
  });

  it("ignores other channels in the response", () => {
    const other = liveStream({ user_id: "11111", id: "other" });
    expect(pickLiveStream([other], "98765")).toBeNull();
  });

  it("returns null when the matched entry is not live", () => {
    expect(pickLiveStream([liveStream({ type: "" })], "98765")).toBeNull();
  });
});