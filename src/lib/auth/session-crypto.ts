import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Session token signing.
 *
 * The token is a signed, self-contained payload: `<base64url json>.<hmac>`.
 * No session table, no lookup on every request.
 *
 * Kept free of Next.js imports so it can be unit tested directly and reused
 * from `proxy.ts`, which runs before the app is loaded.
 */

export interface SessionPayload {
  /** Primary key of the dashboard `User` row. */
  userId: string;
  /** Discord snowflake, handy for logging without a database read. */
  discordId: string;
  /** Expiry as a unix timestamp in seconds. */
  exp: number;
}

/** How long a session stays valid, in seconds. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

/** Build a signed session token. */
export function signSessionToken(
  payload: SessionPayload,
  secret: string,
): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/**
 * Verify a token and return its payload, or null if it is invalid, tampered
 * with, or expired.
 *
 * The signature comparison is constant-time so a wrong signature cannot be
 * discovered byte by byte.
 *
 * `now` is a required argument rather than defaulting to `Date.now()`. A
 * default would read the clock as a side effect of verification, which is
 * both harder to test and incompatible with Next.js prerendering, where
 * reading the clock is treated as unstable output.
 */
export function verifySessionToken(
  token: string | undefined,
  secret: string,
  now: number,
): SessionPayload | null {
  if (!token) return null;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;

  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  const expected = sign(body, secret);
  const provided = Buffer.from(signature);
  const computed = Buffer.from(expected);

  if (provided.length !== computed.length) return null;
  if (!timingSafeEqual(provided, computed)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!isSessionPayload(payload)) return null;
  if (payload.exp * 1000 <= now) return null;

  return payload;
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.userId === "string" &&
    typeof candidate.discordId === "string" &&
    typeof candidate.exp === "number" &&
    Number.isFinite(candidate.exp)
  );
}