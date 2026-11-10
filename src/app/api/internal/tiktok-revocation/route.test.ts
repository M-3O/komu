import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  config: vi.fn(),
  run: vi.fn(),
}));

vi.mock("@/lib/tiktok/config", () => ({
  getTikTokIntegrationStatus: mocks.status,
  getTikTokOAuthConfig: mocks.config,
}));
vi.mock("@/lib/tiktok/connection-store", () => ({
  runTikTokRevocationMaintenance: mocks.run,
}));

import { POST } from "./route";

const SECRET = "local-maintenance-secret-that-is-long-enough";
const CONFIG = {
  clientKey: "synthetic-client-key",
  clientSecret: "synthetic-client-secret",
  redirectUri: "https://komu.example/tiktok/callback",
};

function request(secret?: string): Request {
  return new Request("https://komu.example/api/internal/tiktok-revocation", {
    method: "POST",
    headers: secret ? { "x-tiktok-maintenance-secret": secret } : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TIKTOK_MAINTENANCE_SECRET = SECRET;
  mocks.status.mockReturnValue({ enabled: true, reason: "ready" });
  mocks.config.mockReturnValue(CONFIG);
  mocks.run.mockResolvedValue({ claimed: 1, revoked: 1, failed: 0, purged: 0 });
});

describe("TikTok revocation maintenance endpoint", () => {
  it("requires the separate authenticated secret", async () => {
    await expect(POST(request("wrong-secret"))).resolves.toMatchObject({ status: 401 });
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("stays unavailable while the integration gate is closed", async () => {
    mocks.status.mockReturnValue({ enabled: false, reason: "feature_disabled" });
    await expect(POST(request(SECRET))).resolves.toMatchObject({ status: 503 });
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("runs only through POST and passes the approved bounded workload", async () => {
    await expect(POST(request(SECRET))).resolves.toMatchObject({ status: 200 });
    expect(mocks.run).toHaveBeenCalledWith(CONFIG, { maxItems: 10 });
  });
});
