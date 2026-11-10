import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  config: vi.fn(),
  trustedOrigin: vi.fn(),
  currentUser: vi.fn(),
  guild: vi.fn(),
  createAttempt: vi.fn(),
}));

vi.mock("@/lib/tiktok/config", () => ({
  getTikTokIntegrationStatus: mocks.status,
  getTikTokOAuthConfig: mocks.config,
  getTrustedApplicationOrigin: mocks.trustedOrigin,
  TIKTOK_REQUIRED_SCOPE: "user.info.basic",
}));
vi.mock("@/lib/auth/current-user", () => ({ requireCurrentUser: mocks.currentUser }));
vi.mock("@/lib/dashboard/require-guild", () => ({ requireGuild: mocks.guild }));
vi.mock("@/lib/tiktok/oauth-attempts", () => ({
  createTikTokOAuthAttempt: mocks.createAttempt,
}));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { POST } from "./route";

const CONFIG = {
  clientKey: "client-key",
  clientSecret: "client-secret",
  redirectUri: "https://komu.example/api/integrations/tiktok/callback",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.trustedOrigin.mockReturnValue("https://komu.example");
  mocks.config.mockReturnValue(CONFIG);
  mocks.currentUser.mockResolvedValue({ userId: "owner-user" });
  mocks.guild.mockResolvedValue({ id: "guild-row" });
  mocks.createAttempt.mockResolvedValue({ state: "a".repeat(43) });
});

describe("TikTok connect route", () => {
  it("rejects a cross-site POST before authentication or state creation", async () => {
    mocks.status.mockReturnValue({ enabled: true, reason: "ready" });

    const response = await POST(
      new Request("https://komu.example/api/integrations/tiktok/connect", {
        method: "POST",
        headers: { Origin: "https://evil.example" },
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.currentUser).not.toHaveBeenCalled();
    expect(mocks.createAttempt).not.toHaveBeenCalled();
  });

  it("cannot be enabled by a direct request while the feature gate is closed", async () => {
    mocks.status.mockReturnValue({ enabled: false, reason: "feature_disabled" });

    const response = await POST(
      new Request("https://komu.example/api/integrations/tiktok/connect", {
        method: "POST",
        headers: { Origin: "https://komu.example" },
      }),
    );

    expect(response.headers.get("location")).toContain("tiktok=not_available");
    expect(mocks.currentUser).not.toHaveBeenCalled();
    expect(mocks.createAttempt).not.toHaveBeenCalled();
  });
});
