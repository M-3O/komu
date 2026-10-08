import { describe, expect, it } from "vitest";

import {
  buildChannelUrl,
  normalizeChannel,
  normalizeLivestream,
  parseChannelIdentifier,
  pickAvatar,
} from "./normalize";
import type { KickChannel } from "./types";

/**
 * Kick normalisation.
 *
 * The case that matters most is the finished broadcast: Kick drops the
 * `livestream` block when a channel goes offline, so absence is the signal,
 * and an alert fired on presence alone would re-fire for every past stream.
 */

const ACCOUNT = {
  providerUserId: "1234",
  username: "auronplay",
  displayName: "AuronPlay",
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

describe("pickAvatar", () => {
  it("reads the top-level field", () => {
    expect(pickAvatar({ profile_pic: "a.jpg" })).toBe("a.jpg");
  });

  it("falls back to the nested field", () => {
    // The field sits at two levels depending on the endpoint version.
    expect(pickAvatar({ user: { profile_pic: "b.jpg" } })).toBe("b.jpg");
  });

  it("returns null when there is no picture", () => {
    expect(pickAvatar({})).toBeNull();
    expect(pickAvatar({ profile_pic: "" })).toBeNull();
  });
});

describe("buildChannelUrl", () => {
  it("builds the channel page", () => {
    expect(buildChannelUrl("auronplay")).toBe("https://kick.com/auronplay");
  });
});

describe("normalizeChannel", () => {
  it("prefers the user id as the stable key", () => {
    // The slug can change if the creator renames the channel, which would
    // otherwise break a stored connection.
    const account = normalizeChannel({
      user_id: "1234",
      slug: "auronplay",
      username: "AuronPlay",
      profile_pic: "a.jpg",
    });

    expect(account).toEqual({
      providerUserId: "1234",
      username: "auronplay",
      displayName: "AuronPlay",
      avatarUrl: "a.jpg",
    });
  });

  it("falls back to username when there is no slug", () => {
    const account = normalizeChannel({ user_id: "1234", username: "auronplay" });
    expect(account?.username).toBe("auronplay");
  });

  it("falls back to the slug when there is no username", () => {
    const account = normalizeChannel({ user_id: "1234", slug: "auronplay" });
    expect(account?.displayName).toBe("auronplay");
  });

  it("returns null without an id, which cannot be queried again", () => {
    expect(normalizeChannel({ slug: "auronplay" })).toBeNull();
  });

  it("returns null for an empty response", () => {
    expect(normalizeChannel({})).toBeNull();
  });
});

describe("normalizeLivestream", () => {
  const liveChannel = (overrides: Partial<KickChannel> = {}): KickChannel => ({
    user_id: "1234",
    slug: "auronplay",
    username: "AuronPlay",
    livestream: {
      id: "9999",
      session_title: "Ranked grind",
      is_live: true,
      start_time: "2024-05-17T10:00:00Z",
      viewer_count: 420,
    },
    ...overrides,
  });

  it("normalises a live stream", () => {
    expect(normalizeLivestream(liveChannel(), ACCOUNT)).toMatchObject({
      creatorId: "1234",
      creatorUsername: "auronplay",
      providerStreamId: "9999",
      title: "Ranked grind",
      viewerCount: 420,
      url: "https://kick.com/auronplay",
      startedAt: new Date("2024-05-17T10:00:00Z"),
    });
  });

  it("has no game and no thumbnail", () => {
    const result = normalizeLivestream(liveChannel(), ACCOUNT);

    // Kick reports neither in the public API, and a guessed URL would 404.
    expect(result?.game).toBeNull();
    expect(result?.thumbnail).toBeNull();
  });

  it("returns null when the livestream block is absent", () => {
    // This is how Kick says "offline": the field simply is not there.
    expect(normalizeLivestream({ slug: "auronplay" }, ACCOUNT)).toBeNull();
  });

  it("returns null when the livestream is explicitly not live", () => {
    const stale = liveChannel({
      livestream: { id: "9999", is_live: false },
    });

    expect(normalizeLivestream(stale, ACCOUNT)).toBeNull();
  });

  it("returns null when there is no livestream id", () => {
    const broken = liveChannel({ livestream: { is_live: true } });
    expect(normalizeLivestream(broken, ACCOUNT)).toBeNull();
  });

  it("returns null for an empty channel", () => {
    expect(normalizeLivestream({}, ACCOUNT)).toBeNull();
  });

  it("uses the account's display name rather than re-reading the channel", () => {
    expect(normalizeLivestream(liveChannel(), ACCOUNT)?.creatorDisplayName).toBe(
      "AuronPlay",
    );
  });

  it("handles a zero viewer count as zero, not unknown", () => {
    const nobody = liveChannel({
      livestream: { id: "1", is_live: true, viewer_count: 0 },
    });

    expect(normalizeLivestream(nobody, ACCOUNT)?.viewerCount).toBe(0);
  });

  it("treats a non-numeric viewer count as unknown", () => {
    const odd = liveChannel({
      livestream: {
        id: "1",
        is_live: true,
        viewer_count: "loads" as unknown as number,
      },
    });

    expect(normalizeLivestream(odd, ACCOUNT)?.viewerCount).toBeNull();
  });

  it("ignores an unparseable start time rather than storing Invalid Date", () => {
    const broken = liveChannel({
      livestream: { id: "1", is_live: true, start_time: "yesterday" },
    });

    expect(normalizeLivestream(broken, ACCOUNT)?.startedAt).toBeNull();
  });

  it("accepts a stream with no start time", () => {
    // A broadcast that has just started may not have one yet, and that is
    // still a live session worth alerting on.
    const fresh = liveChannel({ livestream: { id: "1", is_live: true } });
    expect(normalizeLivestream(fresh, ACCOUNT)?.startedAt).toBeNull();
  });
});