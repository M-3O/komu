import { beforeAll, describe, expect, it } from "vitest";

import { decryptToken, encryptToken, isEncryptedToken } from "./token-crypto";

/**
 * Access tokens are bearer credentials, so the property that matters is that
 * the stored form is not the token. A round-trip proves the mechanics; the
 * tamper test proves GCM authenticated it; the legacy test is what lets an
 * existing installation upgrade without signing everybody out.
 */

beforeAll(() => {
  // `getServerConfig` validates the whole environment, but this module only
  // reads AUTH_SECRET. The rest are placeholders so validation can pass.
  process.env.AUTH_SECRET ??=
    "test-secret-value-that-is-at-least-32-characters-long";
  process.env.DATABASE_URL ??= "postgresql://localhost:5432/test";
  process.env.DISCORD_CLIENT_ID ??= "test-client-id";
  process.env.DISCORD_CLIENT_SECRET ??= "test-client-secret";
  process.env.DISCORD_BOT_TOKEN ??= "test-bot-token";
});

const TOKEN = "discord-access-token-value-1234567890";

describe("token encryption", () => {
  it("round-trips a token", () => {
    const stored = encryptToken(TOKEN);

    expect(stored).not.toContain(TOKEN);
    expect(isEncryptedToken(stored)).toBe(true);
    expect(decryptToken(stored)).toBe(TOKEN);
  });

  it("uses a fresh nonce each time", () => {
    const first = encryptToken(TOKEN);
    const second = encryptToken(TOKEN);

    expect(first).not.toBe(second);
    expect(decryptToken(first)).toBe(TOKEN);
    expect(decryptToken(second)).toBe(TOKEN);
  });

  it("round-trips an empty value", () => {
    expect(decryptToken(encryptToken(""))).toBe("");
  });

  it("refuses a tampered ciphertext", () => {
    const parts = encryptToken(TOKEN).split(":");

    // Flip the first six bits of the ciphertext. Changing a trailing base64
    // character would risk landing in discarded padding bits.
    parts[3] = (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1);

    expect(decryptToken(parts.join(":"))).toBeNull();
  });

  it("refuses a malformed value", () => {
    expect(decryptToken("v1:not-enough-parts")).toBeNull();
    expect(decryptToken("v1:a:b")).toBeNull();
  });

  it("reads a pre-encryption token as plaintext", () => {
    // Rows written before this module existed must keep working; the next
    // login rewrites them encrypted.
    expect(isEncryptedToken(TOKEN)).toBe(false);
    expect(decryptToken(TOKEN)).toBe(TOKEN);
  });
});
