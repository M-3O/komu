import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

import { getServerConfig } from "@/lib/config/server-config";

/**
 * Encryption for Discord access tokens at rest.
 *
 * A Discord token is a bearer credential for two scopes: `identify` and
 * `guilds`. Anyone holding one can enumerate every server its owner
 * administers. Storing them in a plain column means a leaked `DATABASE_URL`,
 * a `pg_dump`, or a backup copy hands over live credentials for every
 * dashboard user.
 *
 * AES-256-GCM is used because it authenticates as well as encrypts: a value
 * tampered with in the database fails to decrypt rather than returning
 * attacker-chosen text.
 *
 * The key is derived from `AUTH_SECRET` with HKDF, using an info string that
 * separates it from the session-signing use of the same secret. Rotating
 * `AUTH_SECRET` therefore invalidates stored tokens, which surfaces as a
 * request to sign in again rather than as a corrupted login.
 *
 * Format: `v1:<iv>:<tag>:<ciphertext>`, each part base64url.
 */

/** Marks a value written by this module. Bump only with a migration path. */
const VERSION = "v1";

const ALGORITHM = "aes-256-gcm";

/** GCM's standard nonce length. */
const IV_BYTES = 12;

/** 256-bit key, as the algorithm name requires. */
const KEY_BYTES = 32;

function encryptionKey(): Buffer {
  // Validated, so this also enforces the 32-character minimum on AUTH_SECRET
  // rather than deriving a weak key from a short one.
  const { AUTH_SECRET } = getServerConfig();

  return Buffer.from(
    hkdfSync("sha256", AUTH_SECRET, "komu", "discord-access-token", KEY_BYTES),
  );
}

/** Encrypt a token for storage. Never returns the input unchanged. */
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

/**
 * Decrypt a stored token.
 *
 * Returns `null` when the value cannot be read: a wrong key, a tampered row,
 * or a malformed value. Callers treat that as "sign in again" rather than as
 * an empty token, because the two need different messages.
 *
 * A value without the version prefix is a plaintext token written before
 * encryption existed. It is returned as-is so upgrading does not sign every
 * user out; the next login rewrites the row encrypted.
 */
export function decryptToken(stored: string): string | null {
  if (!stored.startsWith(`${VERSION}:`)) return stored;

  const parts = stored.split(":");

  if (parts.length !== 4) return null;

  const [, iv, tag, ciphertext] = parts;

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      encryptionKey(),
      Buffer.from(iv, "base64url"),
    );

    decipher.setAuthTag(Buffer.from(tag, "base64url"));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/** Whether a stored value was written by this module. */
export function isEncryptedToken(stored: string): boolean {
  return stored.startsWith(`${VERSION}:`);
}
