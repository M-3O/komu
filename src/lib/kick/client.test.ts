import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { getChannel, resetTokenCache } from "./client";

const TOKEN = "kick-access-token";

const CHANNEL = {
  broadcaster_user_id: 676,
  slug: "xqc",
  stream_title: "",
  category: { id: 0, name: "" },
  stream: {
    is_live: false,
    start_time: "0001-01-01T00:00:00Z",
    viewer_count: 0,
    thumbnail: "",
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A fetch stub that answers the token request and a channel lookup. */
function stubFetch(
  channelBody: unknown = { data: [CHANNEL] },
  channelStatus = 200,
) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);

    return url.endsWith("/oauth/token")
      ? jsonResponse({ access_token: TOKEN, expires_in: 3600 })
      : jsonResponse(channelBody, channelStatus);
  });

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

beforeEach(() => {
  process.env.KICK_CLIENT_ID = "client-id";
  process.env.KICK_CLIENT_SECRET = "client-secret";
  resetTokenCache();
  vi.unstubAllGlobals();
});

describe("getChannel", () => {
  it("authenticates with form data, omits scope, and filters by slug", async () => {
    const fetchMock = stubFetch();

    const channel = await getChannel("xqc");

    expect(channel).toEqual(CHANNEL);

    const calls = fetchMock.mock.calls as unknown as Array<
      [string, RequestInit]
    >;
    const [tokenUrl, tokenInit] = calls[0];
    const [channelUrl, channelInit] = calls[1];

    expect(tokenUrl).toBe("https://id.kick.com/oauth/token");
    expect(tokenInit.headers).toMatchObject({
      "Content-Type": "application/x-www-form-urlencoded",
    });

    const form = new URLSearchParams(String(tokenInit.body));

    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("client_id")).toBe("client-id");
    expect(form.get("client_secret")).toBe("client-secret");
    // Kick rejects a scope on this grant with invalid_scope.
    expect(form.get("scope")).toBeNull();

    // The channel is filtered by query string; /channels/{slug} answers 404.
    expect(channelUrl).toBe(
      "https://api.kick.com/public/v1/channels?slug=xqc",
    );
    expect(channelInit.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
    });
  });

  it("encodes the slug instead of pasting it into the query string", async () => {
    const fetchMock = stubFetch();

    await getChannel("a b&c");

    const calls = fetchMock.mock.calls as unknown as Array<[string]>;
    expect(calls[1][0]).toBe(
      "https://api.kick.com/public/v1/channels?slug=a%20b%26c",
    );
  });

  it("returns null when Kick has no channel for the slug", async () => {
    stubFetch({ data: [] });

    expect(await getChannel("nobody")).toBeNull();
  });

  it("returns null when Kick answers 404", async () => {
    stubFetch({ message: "Not Found" }, 404);

    expect(await getChannel("nobody")).toBeNull();
  });

  it("reuses a cached token across lookups", async () => {
    const fetchMock = stubFetch();

    await getChannel("xqc");
    await getChannel("xqc");

    const calls = fetchMock.mock.calls as unknown as Array<[string]>;
    const tokenCalls = calls.filter(([url]) => url.endsWith("/oauth/token"));

    expect(tokenCalls).toHaveLength(1);
  });
});
