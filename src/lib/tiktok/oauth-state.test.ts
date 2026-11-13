import { describe, expect, it } from "vitest";

import {
  createTikTokOAuthState,
  hashTikTokOAuthState,
  isValidTikTokOAuthState,
  TIKTOK_OAUTH_STATE_TTL_SECONDS,
} from "./oauth-state";

describe("TikTok OAuth state", () => {
  it("creates an opaque state and stores only its hash", () => {
    const created = createTikTokOAuthState(
      {
        userId: "owner-user",
        guildId: "guild-row",
        requestedScopes: ["user.info.basic", "video.list"],
        redirectUri: "https://komu.example/api/integrations/tiktok/callback",
        now: 1_000_000,
      },
    );

    expect(isValidTikTokOAuthState(created.state)).toBe(true);
    expect(created.stateHash).toBe(hashTikTokOAuthState(created.state));
    expect(created.stateHash).not.toContain(created.state);
    expect(created.expiresAt.getTime()).toBe(
      1_000_000 + TIKTOK_OAUTH_STATE_TTL_SECONDS * 1000,
    );
  });

  it("generates unique values for concurrent authorization starts", () => {
    const first = createTikTokOAuthState({
      userId: "owner-user",
      guildId: "guild-row",
      requestedScopes: [],
      redirectUri: "https://komu.example/callback",
    });
    const second = createTikTokOAuthState({
      userId: "owner-user",
      guildId: "guild-row",
      requestedScopes: [],
      redirectUri: "https://komu.example/callback",
    });

    expect(first.state).not.toBe(second.state);
    expect(first.stateHash).not.toBe(second.stateHash);
  });

  it("rejects malformed provider state", () => {
    expect(isValidTikTokOAuthState(null)).toBe(false);
    expect(isValidTikTokOAuthState("not-a-state")).toBe(false);
    expect(isValidTikTokOAuthState("0".repeat(42))).toBe(false);
  });
});
