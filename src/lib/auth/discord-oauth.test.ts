import { beforeAll, describe, expect, it, vi } from "vitest";

import { buildDiscordAuthorizeUrl, exchangeCodeForToken } from "./discord-oauth";

/**
 * PKCE is only as good as the two requests that carry it.
 *
 * The authorize URL must advertise an S256 challenge, and the token exchange
 * must present the matching verifier. Neither is visible from the callback
 * test (there is none), so these assertions are what keep a future refactor
 * from quietly dropping one half and turning PKCE into decoration.
 */

const APP_URL = "https://komu.example";

beforeAll(() => {
  // `getServerConfig` validates the whole environment even though these
  // functions read only part of it. Values are fixed rather than defaulted so
  // the assertions below do not depend on a developer's `.env.local`.
  process.env.AUTH_SECRET = "a".repeat(32);
  process.env.DATABASE_URL = "postgresql://localhost:5432/test";
  process.env.DISCORD_CLIENT_ID = "client-id";
  process.env.DISCORD_CLIENT_SECRET = "client-secret";
  process.env.DISCORD_BOT_TOKEN = "bot-token";
  process.env.NEXT_PUBLIC_APP_URL = APP_URL;
});

describe("buildDiscordAuthorizeUrl", () => {
  it("sends the state, the S256 challenge and the callback", () => {
    const url = new URL(
      buildDiscordAuthorizeUrl("state-value", "challenge-value"),
    );

    expect(url.origin + url.pathname).toBe(
      "https://discord.com/oauth2/authorize",
    );
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-value");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(`${APP_URL}/callback`);
    expect(url.searchParams.get("scope")).toBe("identify guilds");
  });
});

describe("exchangeCodeForToken", () => {
  it("presents the verifier alongside the code", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "discord-access-token",
            token_type: "Bearer",
            expires_in: 604_800,
            refresh_token: "discord-refresh-token",
            scope: "identify guilds",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const token = await exchangeCodeForToken("auth-code", "verifier-value");

      expect(token.access_token).toBe("discord-access-token");

      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];

      expect(url).toBe("https://discord.com/api/v10/oauth2/token");
      expect(init.method).toBe("POST");

      const body = new URLSearchParams(String(init.body));
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code")).toBe("auth-code");
      expect(body.get("code_verifier")).toBe("verifier-value");
      expect(body.get("redirect_uri")).toBe(`${APP_URL}/callback`);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not pass Discord's error body to the visitor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("invalid_grant", { status: 400 })),
    );

    try {
      await expect(
        exchangeCodeForToken("bad-code", "verifier-value"),
      ).rejects.toThrow("Could not complete Discord sign-in. Please try again.");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
