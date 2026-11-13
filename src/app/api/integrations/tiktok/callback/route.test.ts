import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  getConfig: vi.fn(),
  getTrustedOrigin: vi.fn(),
  currentUser: vi.fn(),
  guild: vi.fn(),
  consumeAttempt: vi.fn(),
  exchange: vi.fn(),
  fetchUser: vi.fn(),
  revoke: vi.fn(),
  saveConnection: vi.fn(),
  log: vi.fn(),
}));

vi.mock("@/lib/tiktok/config", () => ({
  getTikTokIntegrationStatus: mocks.getStatus,
  getTikTokOAuthConfig: mocks.getConfig,
  getTrustedApplicationOrigin: mocks.getTrustedOrigin,
}));
vi.mock("@/lib/auth/current-user", () => ({ requireCurrentUser: mocks.currentUser }));
vi.mock("@/lib/dashboard/require-guild", () => ({ requireGuild: mocks.guild }));
vi.mock("@/lib/tiktok/connection-store", () => ({
  saveTikTokConnection: mocks.saveConnection,
}));
vi.mock("@/lib/tiktok/oauth-attempts", () => ({
  consumeTikTokOAuthAttempt: mocks.consumeAttempt,
}));
vi.mock("@/lib/tiktok/oauth", () => ({
  TikTokApiError: class TikTokApiError extends Error {
    code = "MOCK_TIKTOK_ERROR";
  },
  exchangeTikTokCode: mocks.exchange,
  fetchTikTokUserInfo: mocks.fetchUser,
  revokeTikTokAccessToken: mocks.revoke,
  parseTikTokScopes: (value: string) =>
    new Set(value.split(",").map((scope) => scope.trim()).filter(Boolean)),
  validateTikTokScopes: (granted: Iterable<string>, requested: string[]) => {
    const scopes = new Set(granted);
    return {
      valid: [...scopes].every((scope) =>
        ["user.info.basic", "video.list"].includes(scope),
      ),
      requiredGranted: scopes.has("user.info.basic"),
      optionalMissing: requested.filter(
        (scope) => scope !== "user.info.basic" && !scopes.has(scope),
      ),
    };
  },
}));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ info: mocks.log, warn: mocks.log, error: mocks.log }),
}));

import { createTikTokOAuthState } from "@/lib/tiktok/oauth-state";
import { GET } from "./route";

const CONFIG = {
  clientKey: "client-key",
  clientSecret: "client-secret",
  redirectUri: "https://komu.example/api/integrations/tiktok/callback",
};

let requestNumber = 0;

function request(query: string) {
  requestNumber += 1;
  return new Request(`https://komu.example/api/integrations/tiktok/callback?${query}`, {
    headers: { "x-forwarded-for": `unit-tiktok-${requestNumber}` },
  });
}

function setState() {
  const created = createTikTokOAuthState(
    {
      userId: "owner-user",
      guildId: "guild-row",
      requestedScopes: ["user.info.basic"],
      redirectUri: CONFIG.redirectUri,
    },
  );
  mocks.consumeAttempt.mockResolvedValue({
    id: "attempt-id",
    userId: "owner-user",
    guildId: "guild-row",
    requestedScopes: ["user.info.basic"],
    redirectUri: CONFIG.redirectUri,
    expiresAt: created.expiresAt,
  });
  return created.state;
}

function token(scope = "user.info.basic") {
  return {
    access_token: "access-token",
    expires_in: 7200,
    refresh_token: "refresh-token",
    refresh_expires_in: 15552000,
    open_id: "open-id",
    scope,
    token_type: "Bearer",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getStatus.mockReturnValue({ enabled: true, reason: "ready" });
  mocks.getConfig.mockReturnValue(CONFIG);
  mocks.getTrustedOrigin.mockReturnValue("https://komu.example");
  mocks.currentUser.mockResolvedValue({ userId: "owner-user" });
  mocks.guild.mockResolvedValue({ id: "guild-row" });
  mocks.exchange.mockResolvedValue(token());
  mocks.fetchUser.mockResolvedValue({
    open_id: "open-id",
    display_name: "Creator",
    avatar_url: null,
  });
  mocks.revoke.mockResolvedValue(undefined);
  mocks.saveConnection.mockResolvedValue(undefined);
  mocks.consumeAttempt.mockResolvedValue(null);
});

describe("TikTok OAuth callback security", () => {
  it("rejects a mismatched state before exchanging the code", async () => {
    setState();

    const response = await GET(request("code=code&state=wrong"));

    expect(response.headers.get("location")).toContain("tiktok=state_mismatch");
    expect(mocks.exchange).not.toHaveBeenCalled();
  });

  it("consumes state once and rejects a replay", async () => {
    const state = setState();
    mocks.consumeAttempt.mockResolvedValueOnce({
      id: "attempt-id",
      userId: "owner-user",
      guildId: "guild-row",
      requestedScopes: ["user.info.basic"],
      redirectUri: CONFIG.redirectUri,
      expiresAt: new Date(Date.now() + 1000),
    });
    mocks.consumeAttempt.mockResolvedValueOnce(null);

    const first = await GET(request(`code=code&state=${state}`));
    expect(first.headers.get("location")).toContain("tiktok=connected");
    expect(mocks.exchange).toHaveBeenCalledOnce();
    expect(mocks.saveConnection).toHaveBeenCalledOnce();

    const second = await GET(request(`code=code&state=${state}`));
    expect(second.headers.get("location")).toContain("tiktok=state_mismatch");
    expect(mocks.exchange).toHaveBeenCalledOnce();
  });

  it("revokes and rejects a grant that omitted the required basic scope", async () => {
    const state = setState();
    mocks.exchange.mockResolvedValue(token("video.list"));

    const response = await GET(request(`code=code&state=${state}`));

    expect(response.headers.get("location")).toContain("tiktok=scope_denied");
    expect(mocks.fetchUser).not.toHaveBeenCalled();
    expect(mocks.revoke).toHaveBeenCalledWith("access-token", CONFIG);
  });

  it("rechecks the owner and guild binding before provider calls", async () => {
    const state = setState();
    mocks.currentUser.mockResolvedValue({ userId: "another-user" });
    mocks.consumeAttempt.mockResolvedValue(null);

    const response = await GET(request(`code=code&state=${state}`));

    expect(response.headers.get("location")).toContain("tiktok=state_mismatch");
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
});
