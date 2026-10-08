import { describe, expect, it } from "vitest";

import {
  SESSION_TTL_SECONDS,
  signSessionToken,
  verifySessionToken,
  type SessionPayload,
} from "./session-crypto";

const SECRET = "a".repeat(32);
const OTHER_SECRET = "b".repeat(32);

/** Fixed "current time" so expiry checks are deterministic. */
const NOW = 1_700_000_000_000;
const NOW_SECONDS = Math.floor(NOW / 1000);

function makePayload(overrides: Partial<SessionPayload> = {}): SessionPayload {
  return {
    userId: "user_123",
    discordId: "555123456789",
    exp: NOW_SECONDS + 3600,
    ...overrides,
  };
}

const payload = makePayload();

describe("signSessionToken", () => {
  it("produces a payload.signature pair", () => {
    const token = signSessionToken(payload, SECRET);
    expect(token.split(".")).toHaveLength(2);
  });

  it("round-trips through verifySessionToken", () => {
    const token = signSessionToken(payload, SECRET);
    expect(verifySessionToken(token, SECRET, NOW)).toEqual(payload);
  });

  it("is deterministic for the same payload and secret", () => {
    expect(signSessionToken(payload, SECRET)).toBe(
      signSessionToken(payload, SECRET),
    );
  });

  it("produces different tokens for different secrets", () => {
    expect(signSessionToken(payload, SECRET)).not.toBe(
      signSessionToken(payload, OTHER_SECRET),
    );
  });
});

describe("verifySessionToken", () => {
  it("rejects a token signed with a different secret", () => {
    const token = signSessionToken(payload, SECRET);
    expect(verifySessionToken(token, OTHER_SECRET, NOW)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const [body, signature] = signSessionToken(payload, SECRET).split(".");

    // Re-encode the body with a different user while keeping the signature.
    const forged = Buffer.from(
      JSON.stringify({ ...payload, userId: "attacker" }),
    ).toString("base64url");

    expect(verifySessionToken(`${forged}.${signature}`, SECRET, NOW)).toBeNull();
    expect(verifySessionToken(`${body}.${signature}`, SECRET, NOW)).not.toBeNull();
  });

  it("rejects a tampered signature", () => {
    const [body, signature] = signSessionToken(payload, SECRET).split(".");
    const flipped =
      signature.slice(0, -1) + (signature.at(-1) === "A" ? "B" : "A");

    expect(verifySessionToken(`${body}.${flipped}`, SECRET, NOW)).toBeNull();
  });

  it("rejects a token one millisecond past expiry", () => {
    const token = signSessionToken(payload, SECRET);
    const justAfter = payload.exp * 1000 + 1;

    expect(verifySessionToken(token, SECRET, justAfter)).toBeNull();
  });

  it("accepts a token one millisecond before expiry", () => {
    const token = signSessionToken(payload, SECRET);
    const justBefore = payload.exp * 1000 - 1;

    expect(verifySessionToken(token, SECRET, justBefore)).not.toBeNull();
  });

  it("rejects malformed input", () => {
    expect(verifySessionToken(undefined, SECRET, NOW)).toBeNull();
    expect(verifySessionToken("", SECRET, NOW)).toBeNull();
    expect(verifySessionToken("no-separator", SECRET, NOW)).toBeNull();
    expect(verifySessionToken(".onlysig", SECRET, NOW)).toBeNull();
    expect(verifySessionToken("bodyonly.", SECRET, NOW)).toBeNull();
  });

  it("rejects a well-signed token with an unexpected payload shape", () => {
    const bad = Buffer.from(JSON.stringify({ userId: 1 })).toString("base64url");
    const token = signSessionToken(bad as never, SECRET);

    expect(verifySessionToken(token, SECRET, NOW)).toBeNull();
  });
});

describe("SESSION_TTL_SECONDS", () => {
  it("is one week", () => {
    expect(SESSION_TTL_SECONDS).toBe(60 * 60 * 24 * 7);
  });
});