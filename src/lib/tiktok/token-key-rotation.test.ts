import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { tikTokConnection: fake },
}));

import {
  encryptTikTokToken,
  TIKTOK_ROTATED_TOKEN_PREFIX,
} from "@/lib/auth/provider-token-crypto";
import { reencryptTikTokConnectionTokens } from "./token-key-rotation";

const firstKey = Buffer.alloc(32, 3).toString("base64url");
const secondKey = Buffer.alloc(32, 4).toString("base64url");

beforeEach(() => {
  process.env.AUTH_SECRET ??= "test-secret-value-that-is-at-least-32-characters-long";
  process.env.DATABASE_URL ??= "postgresql://localhost:5432/test";
  process.env.DISCORD_CLIENT_ID ??= "test-client-id";
  process.env.DISCORD_CLIENT_SECRET ??= "test-client-secret";
  process.env.DISCORD_BOT_TOKEN ??= "test-bot-token";
  process.env.TIKTOK_TOKEN_ENCRYPTION_KEYS = `k1=${firstKey},k2=${secondKey}`;
  process.env.TIKTOK_TOKEN_ENCRYPTION_ACTIVE_KEY = "k2";
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.TIKTOK_TOKEN_ENCRYPTION_KEYS;
  delete process.env.TIKTOK_TOKEN_ENCRYPTION_ACTIVE_KEY;
});

describe("TikTok token key rotation", () => {
  it("rewrites old tokens with a CAS and never includes plaintext", async () => {
    delete process.env.TIKTOK_TOKEN_ENCRYPTION_KEYS;
    delete process.env.TIKTOK_TOKEN_ENCRYPTION_ACTIVE_KEY;
    const oldAccess = encryptTikTokToken("old-access");
    const oldRefresh = encryptTikTokToken("old-refresh");
    process.env.TIKTOK_TOKEN_ENCRYPTION_KEYS = `k1=${firstKey},k2=${secondKey}`;
    process.env.TIKTOK_TOKEN_ENCRYPTION_ACTIVE_KEY = "k2";
    fake.findMany.mockResolvedValue([{
      id: "connection-id",
      credentialsVersion: 7,
      accessToken: oldAccess,
      refreshToken: oldRefresh,
      refreshLeaseToken: null,
      disconnectLeaseToken: null,
    }]);
    fake.updateMany.mockResolvedValue({ count: 1 });

    await expect(reencryptTikTokConnectionTokens()).resolves.toEqual({
      scanned: 1,
      rotated: 1,
      skipped: 0,
      failed: 0,
    });
    const update = fake.updateMany.mock.calls[0]?.[0];
    expect(update.where.credentialsVersion).toBe(7);
    expect(update.data.accessToken).toMatch(new RegExp(`^${TIKTOK_ROTATED_TOKEN_PREFIX}:k2:`));
    expect(update.data.refreshToken).toMatch(new RegExp(`^${TIKTOK_ROTATED_TOKEN_PREFIX}:k2:`));
    expect(update.data.accessToken).not.toContain("old-access");
  });

  it("skips active leases and reports undecryptable rows without overwriting them", async () => {
    fake.findMany.mockResolvedValue([
      {
        id: "busy",
        credentialsVersion: 1,
        accessToken: "tiktok:v1:corrupt",
        refreshToken: null,
        refreshLeaseToken: "refreshing",
        disconnectLeaseToken: null,
      },
      {
        id: "bad",
        credentialsVersion: 2,
        accessToken: "tiktok:v1:corrupt",
        refreshToken: null,
        refreshLeaseToken: null,
        disconnectLeaseToken: null,
      },
    ]);

    await expect(reencryptTikTokConnectionTokens()).resolves.toEqual({
      scanned: 2,
      rotated: 0,
      skipped: 1,
      failed: 1,
    });
    expect(fake.updateMany).not.toHaveBeenCalled();
  });
});
