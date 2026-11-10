import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { decryptToken } from "./token-crypto";
import {
  decryptTikTokToken,
  encryptTikTokToken,
  isEncryptedTikTokToken,
  reencryptTikTokToken,
  TIKTOK_ROTATED_TOKEN_PREFIX,
} from "./provider-token-crypto";

beforeAll(() => {
  process.env.AUTH_SECRET ??=
    "test-secret-value-that-is-at-least-32-characters-long";
  process.env.DATABASE_URL ??= "postgresql://localhost:5432/test";
  process.env.DISCORD_CLIENT_ID ??= "test-client-id";
  process.env.DISCORD_CLIENT_SECRET ??= "test-client-secret";
  process.env.DISCORD_BOT_TOKEN ??= "test-bot-token";
});

afterEach(() => {
  delete process.env.TIKTOK_TOKEN_ENCRYPTION_KEYS;
  delete process.env.TIKTOK_TOKEN_ENCRYPTION_ACTIVE_KEY;
});

describe("TikTok provider token encryption", () => {
  it("round-trips with a provider-specific versioned format", () => {
    const stored = encryptTikTokToken("tiktok-access-token");

    expect(stored.startsWith("tiktok:v1:")).toBe(true);
    expect(stored).not.toContain("tiktok-access-token");
    expect(isEncryptedTikTokToken(stored)).toBe(true);
    expect(decryptTikTokToken(stored)).toBe("tiktok-access-token");
  });

  it("is not accepted by the Discord token decryptor", () => {
    const stored = encryptTikTokToken("tiktok-refresh-token");

    expect(decryptToken(stored)).toBeNull();
  });

  it("rejects plaintext and tampered ciphertext", () => {
    expect(decryptTikTokToken("tiktok-refresh-token")).toBeNull();

    const parts = encryptTikTokToken("tiktok-refresh-token").split(":");
    parts[4] = (parts[4][0] === "A" ? "B" : "A") + parts[4].slice(1);
    expect(decryptTikTokToken(parts.join(":"))).toBeNull();
  });

  it("rotates TikTok keys without changing Discord encryption", () => {
    const firstKey = Buffer.alloc(32, 1).toString("base64url");
    const secondKey = Buffer.alloc(32, 2).toString("base64url");
    process.env.TIKTOK_TOKEN_ENCRYPTION_KEYS = `k1=${firstKey}`;
    process.env.TIKTOK_TOKEN_ENCRYPTION_ACTIVE_KEY = "k1";

    const oldTikTok = encryptTikTokToken("rotating-token");
    expect(oldTikTok.startsWith(`${TIKTOK_ROTATED_TOKEN_PREFIX}:k1:`)).toBe(true);
    expect(decryptTikTokToken(oldTikTok)).toBe("rotating-token");

    process.env.TIKTOK_TOKEN_ENCRYPTION_KEYS = `k1=${firstKey},k2=${secondKey}`;
    process.env.TIKTOK_TOKEN_ENCRYPTION_ACTIVE_KEY = "k2";
    expect(decryptTikTokToken(oldTikTok)).toBe("rotating-token");

    const rotated = reencryptTikTokToken(oldTikTok);
    expect(rotated?.startsWith(`${TIKTOK_ROTATED_TOKEN_PREFIX}:k2:`)).toBe(true);
    expect(decryptTikTokToken(rotated!)).toBe("rotating-token");

    process.env.TIKTOK_TOKEN_ENCRYPTION_KEYS = `k2=${secondKey}`;
    expect(decryptTikTokToken(oldTikTok)).toBeNull();
    expect(decryptTikTokToken(rotated!)).toBe("rotating-token");
  });
});
