import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildTikTokAuthorizeUrl,
  exchangeTikTokCode,
  fetchTikTokUserInfo,
  refreshTikTokAccessToken,
  revokeTikTokAccessToken,
  safeTikTokErrorCategory,
  TikTokApiError,
  validateTikTokScopes,
} from "./oauth";

const config = {
  clientKey: "client-key",
  clientSecret: "client-secret",
  redirectUri: "https://komu.example/api/integrations/tiktok/callback",
};

describe("TikTok official OAuth client", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("builds the v2 web authorization URL without PKCE or secret values", () => {
    const url = new URL(
      buildTikTokAuthorizeUrl(config, "state-value", ["user.info.basic"]),
    );

    expect(url.origin + url.pathname).toBe(
      "https://www.tiktok.com/v2/auth/authorize/",
    );
    expect(url.searchParams.get("client_key")).toBe("client-key");
    expect(url.searchParams.get("scope")).toBe("user.info.basic");
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.searchParams.get("code_challenge")).toBeNull();
    expect(url.toString()).not.toContain("client-secret");
  });

  it("does not build an authorization URL for an unapproved scope", () => {
    expect(() =>
      buildTikTokAuthorizeUrl(config, "state-value", ["user.info.profile"]),
    ).toThrow("unsupported scope");
  });

  it("recognizes required and optional partial consent separately", async () => {
    expect(
      validateTikTokScopes(["user.info.basic"], ["user.info.basic", "video.list"]),
    ).toEqual({
      valid: true,
      requiredGranted: true,
      optionalMissing: ["video.list"],
      invalidRequested: [],
      unexpectedGranted: [],
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "access",
          expires_in: 7200,
          refresh_token: "refresh",
          refresh_expires_in: 15552000,
          open_id: "open-id",
          scope: "user.info.basic",
          token_type: "Bearer",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const token = await exchangeTikTokCode("authorization-code", config);
    expect(token.open_id).toBe("open-id");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://open.tiktokapis.com/v2/oauth/token/",
      expect.objectContaining({ method: "POST" }),
    );
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain(
      "grant_type=authorization_code",
    );
  });

  it("uses the official refresh and revoke endpoints", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "new-access",
            expires_in: 7200,
            refresh_token: "rotated-refresh",
            refresh_expires_in: 15552000,
            open_id: "open-id",
            scope: "user.info.basic",
            token_type: "Bearer",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(refreshTikTokAccessToken("old-refresh", config)).resolves.toMatchObject({
      refresh_token: "rotated-refresh",
    });
    await expect(revokeTikTokAccessToken("new-access", config)).resolves.toBeUndefined();

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://open.tiktokapis.com/v2/oauth/token/",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://open.tiktokapis.com/v2/oauth/revoke/",
    );
  });

  it("rejects scopes outside the approved allowlist", () => {
    expect(
      validateTikTokScopes(
        ["user.info.basic", "user.info.profile"],
        ["user.info.basic", "user.info.profile"],
      ),
    ).toMatchObject({
      valid: false,
      requiredGranted: true,
      invalidRequested: ["user.info.profile"],
      unexpectedGranted: ["user.info.profile"],
    });
  });

  it("maps provider-controlled error text to fixed safe categories", () => {
    expect(
      safeTikTokErrorCategory(new TikTokApiError({ code: "invalid_grant", status: 400 })),
    ).toBe("invalid_grant");
    expect(
      safeTikTokErrorCategory(new TikTokApiError({ code: "secret-marker", status: 500 })),
    ).toBe("provider_error");
    expect(safeTikTokErrorCategory(new Error("secret-marker"))).toBe("internal_error");
  });

  it("rejects empty, non-positive, and non-Bearer token responses", async () => {
    for (const response of [
      {
        access_token: "",
        expires_in: 7200,
        refresh_token: "refresh",
        refresh_expires_in: 15552000,
        open_id: "open-id",
        scope: "user.info.basic",
        token_type: "Bearer",
      },
      {
        access_token: "access",
        expires_in: 0,
        refresh_token: "refresh",
        refresh_expires_in: 15552000,
        open_id: "open-id",
        scope: "user.info.basic",
        token_type: "Bearer",
      },
      {
        access_token: "access",
        expires_in: 7200,
        refresh_token: "refresh",
        refresh_expires_in: 15552000,
        open_id: "open-id",
        scope: "user.info.basic",
        token_type: "Basic",
      },
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(response), { status: 200 }),
        ),
      );

      await expect(exchangeTikTokCode("authorization-code", config)).rejects.toMatchObject({
        code: "malformed_response",
      });
    }
  });

  it("requests only the approved basic user fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { user: { open_id: "open-id", display_name: "Creator" } },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchTikTokUserInfo("access-token")).resolves.toEqual({
      open_id: "open-id",
      display_name: "Creator",
      avatar_url: null,
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "fields=open_id%2Cdisplay_name%2Cavatar_url",
    );
  });
});
