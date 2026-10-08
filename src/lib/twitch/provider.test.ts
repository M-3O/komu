import { describe, expect, it } from "vitest";

import { StreamingProvider } from "@prisma/client";

import {
  LIVE_STREAM_RESPONSE,
  MINIMAL_STREAM_RESPONSE,
  OFFLINE_STREAM_RESPONSE,
  USER_RESPONSE,
  USER_WITHOUT_IMAGE_RESPONSE,
} from "./fixtures";
import { resetTokenCache } from "./client";
import { twitchAdapter } from "./provider";

/**
 * Adapter behaviour against captured Twitch payloads.
 *
 * `fetch` is stubbed, so these cover the whole path from a raw API response
 * to `StreamInfo` without needing credentials or network access.
 */

const ORIGINAL_FETCH = globalThis.fetch;

interface StubCall {
  url: string;
  headers: Record<string, string>;
  /** Request body as text, so POST parameters can be asserted on. */
  body: string | null;
}

/** Read a request body that may be a string or a URLSearchParams. */
function readBody(body: BodyInit | null | undefined): string | null {
  if (body === null || body === undefined) return null;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  return null;
}

/**
 * Stub the Twitch API.
 *
 * The token endpoint is handled automatically, so a test only describes the
 * Helix responses it cares about. Each Helix call consumes the next entry,
 * and the last entry repeats if there are more calls than entries.
 */
function stubFetch(responses: Array<{ status?: number; body: unknown }>): StubCall[] {
  const calls: StubCall[] = [];
  let index = 0;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    calls.push({
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: readBody(init?.body),
    });

    if (url.includes("id.twitch.tv")) {
      return new Response(
        JSON.stringify({ access_token: "test-token", expires_in: 3600 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;

    return new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  return calls;
}

/** Run with Twitch credentials present, restoring the environment after. */
async function withEnv<T>(run: () => Promise<T>): Promise<T> {
  const previousId = process.env.TWITCH_CLIENT_ID;
  const previousSecret = process.env.TWITCH_CLIENT_SECRET;

  process.env.TWITCH_CLIENT_ID = "client-id";
  process.env.TWITCH_CLIENT_SECRET = "client-secret";
  resetTokenCache();

  try {
    return await run();
  } finally {
    if (previousId === undefined) delete process.env.TWITCH_CLIENT_ID;
    else process.env.TWITCH_CLIENT_ID = previousId;

    if (previousSecret === undefined) delete process.env.TWITCH_CLIENT_SECRET;
    else process.env.TWITCH_CLIENT_SECRET = previousSecret;

    resetTokenCache();
    globalThis.fetch = ORIGINAL_FETCH;
  }
}

const account = {
  providerUserId: "98765",
  username: "sandysanderman",
  displayName: "SandySanderman",
  avatarUrl: null,
};

describe("twitchAdapter.getLiveStream", () => {
  it("returns normalised data for a live channel", async () => {
    await withEnv(async () => {
      stubFetch([{ body: LIVE_STREAM_RESPONSE }]);

      const stream = await twitchAdapter.getLiveStream(account);

      expect(stream).not.toBeNull();
      expect(stream?.provider).toBe(StreamingProvider.TWITCH);
      expect(stream?.creatorId).toBe("98765");
      expect(stream?.providerStreamId).toBe("123456789");
      expect(stream?.title).toBe("hablamos y le damos a Little Nightmares 1");
      expect(stream?.game).toBe("Little Nightmares");
      expect(stream?.viewerCount).toBe(78365);
      expect(stream?.url).toBe("https://www.twitch.tv/sandysanderman");
      expect(stream?.startedAt?.toISOString()).toBe("2021-03-10T15:04:21.000Z");
      // The size placeholders must not survive into the stored value.
      expect(stream?.thumbnail).not.toContain("{");
    });
  });

  it("returns null when the channel is offline", async () => {
    await withEnv(async () => {
      stubFetch([{ body: OFFLINE_STREAM_RESPONSE }]);
      expect(await twitchAdapter.getLiveStream(account)).toBeNull();
    });
  });

  it("handles a channel with no title, category or viewers", async () => {
    await withEnv(async () => {
      stubFetch([{ body: MINIMAL_STREAM_RESPONSE }]);

      const stream = await twitchAdapter.getLiveStream({
        ...account,
        username: "quietchannel",
      });

      expect(stream?.title).toBeNull();
      expect(stream?.game).toBeNull();
      // Zero viewers is real data, not missing data.
      expect(stream?.viewerCount).toBe(0);
    });
  });

  it("asks for live streams only and sends the client id", async () => {
    await withEnv(async () => {
      const calls = stubFetch([{ body: LIVE_STREAM_RESPONSE }]);
      await twitchAdapter.getLiveStream(account);

      const streamCall = calls.find((call) => call.url.includes("/streams"));
      expect(streamCall?.url).toContain("type=live");
      expect(streamCall?.url).toContain("user_id=98765");
      expect(streamCall?.headers["Client-Id"]).toBe("client-id");
      expect(streamCall?.headers.Authorization).toBe("Bearer test-token");
    });
  });

  it("throws a clear error when Twitch is not configured", async () => {
    const previousId = process.env.TWITCH_CLIENT_ID;
    const previousSecret = process.env.TWITCH_CLIENT_SECRET;
    delete process.env.TWITCH_CLIENT_ID;
    delete process.env.TWITCH_CLIENT_SECRET;
    resetTokenCache();

    try {
      await expect(twitchAdapter.getLiveStream(account)).rejects.toThrow(
        /Twitch is not configured/,
      );
    } finally {
      process.env.TWITCH_CLIENT_ID = previousId;
      process.env.TWITCH_CLIENT_SECRET = previousSecret;
      resetTokenCache();
      globalThis.fetch = ORIGINAL_FETCH;
    }
  });

  it("surfaces a rate limit as a readable error", async () => {
    await withEnv(async () => {
      stubFetch([
        { status: 429, body: { error: "Too Many Requests", status: 429 } },
      ]);

      await expect(twitchAdapter.getLiveStream(account)).rejects.toThrow(
        /rate limiting/i,
      );
    });
  });
});

describe("twitchAdapter.getAccount", () => {
  it("resolves a login to an account", async () => {
    await withEnv(async () => {
      stubFetch([{ body: USER_RESPONSE }]);

      const resolved = await twitchAdapter.getAccount("SandySanderman");

      expect(resolved?.providerUserId).toBe("98765");
      expect(resolved?.username).toBe("sandysanderman");
      expect(resolved?.displayName).toBe("SandySanderman");
      expect(resolved?.avatarUrl).toContain("jtv_user_pictures");
    });
  });

  it("lowercases a login before sending it", async () => {
    await withEnv(async () => {
      const calls = stubFetch([{ body: USER_RESPONSE }]);
      await twitchAdapter.getAccount("SANDYSANDERMAN");

      const usersCall = calls.find((call) => call.url.includes("/users"));
      expect(usersCall?.url).toContain("login=sandysanderman");
    });
  });

  it("treats a numeric identifier as a user id", async () => {
    await withEnv(async () => {
      const calls = stubFetch([{ body: USER_RESPONSE }]);
      await twitchAdapter.getAccount("98765");

      const usersCall = calls.find((call) => call.url.includes("/users"));
      expect(usersCall?.url).toContain("id=98765");
    });
  });

  it("returns null when the channel does not exist", async () => {
    await withEnv(async () => {
      stubFetch([{ body: { data: [], pagination: {} } }]);
      expect(await twitchAdapter.getAccount("nobodyhere")).toBeNull();
    });
  });

  it("returns null for a blank identifier without calling Twitch", async () => {
    await withEnv(async () => {
      const calls = stubFetch([{ body: USER_RESPONSE }]);

      expect(await twitchAdapter.getAccount("   ")).toBeNull();
      expect(calls).toHaveLength(0);
    });
  });

  it("handles a user with no profile image", async () => {
    await withEnv(async () => {
      stubFetch([{ body: USER_WITHOUT_IMAGE_RESPONSE }]);

      const resolved = await twitchAdapter.getAccount("quietchannel");

      expect(resolved?.avatarUrl).toBeNull();
      // Falls back to the login when there is no display name.
      expect(resolved?.displayName).toBe("quietchannel");
    });
  });
});

describe("twitchAdapter.isLive", () => {
  it("is true when the channel appears in the live list", async () => {
    await withEnv(async () => {
      stubFetch([{ body: LIVE_STREAM_RESPONSE }]);
      expect(await twitchAdapter.isLive(account)).toBe(true);
    });
  });

  it("is false when the channel is absent from the live list", async () => {
    await withEnv(async () => {
      stubFetch([{ body: OFFLINE_STREAM_RESPONSE }]);
      expect(await twitchAdapter.isLive(account)).toBe(false);
    });
  });
});

describe("app access token", () => {
  it("requests a client credentials token and reuses it", async () => {
    await withEnv(async () => {
      const calls = stubFetch([{ body: LIVE_STREAM_RESPONSE }]);

      await twitchAdapter.getLiveStream(account);
      await twitchAdapter.getLiveStream(account);

      const tokenCalls = calls.filter((call) => call.url.includes("id.twitch.tv"));
      const streamCalls = calls.filter((call) => call.url.includes("/streams"));

      // One token request serves both stream lookups.
      expect(tokenCalls).toHaveLength(1);
      expect(streamCalls).toHaveLength(2);
      expect(
        streamCalls.every(
          (call) => call.headers.Authorization === "Bearer test-token",
        ),
      ).toBe(true);

      // Credentials travel in the POST body, not the query string.
      expect(tokenCalls[0]?.body).toContain("grant_type=client_credentials");
      expect(tokenCalls[0]?.body).toContain("client_id=client-id");
    });
  });
});