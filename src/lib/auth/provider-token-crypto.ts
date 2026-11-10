import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

import { getServerConfig } from "@/lib/config/server-config";

/**
 * TikTok bearer credentials use a provider-specific namespace and key. This
 * prevents a ciphertext written for one integration from being accepted as a
 * credential for another integration, even though both derive from AUTH_SECRET.
 *
 * Format: `tiktok:v1:<iv>:<tag>:<ciphertext>`, each part base64url except the
 * fixed prefix.
 */
export const TIKTOK_TOKEN_PREFIX = "tiktok:v1";
export const TIKTOK_ROTATED_TOKEN_PREFIX = "tiktok:v2";

const TIKTOK_KEYRING_ENV = "TIKTOK_TOKEN_ENCRYPTION_KEYS";
const TIKTOK_ACTIVE_KEY_ENV = "TIKTOK_TOKEN_ENCRYPTION_ACTIVE_KEY";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

function encryptionKey(): Buffer {
  const { AUTH_SECRET } = getServerConfig();

  return Buffer.from(
    hkdfSync(
      "sha256",
      AUTH_SECRET,
      "komu",
      "tiktok-oauth-token:v1",
      KEY_BYTES,
    ),
  );
}

type TikTokKey = { id: string; material: Buffer };

/**
 * Parse the approved TikTok-only keyring. The value is intentionally read
 * directly from the server environment rather than ServerConfig so changing
 * the active key does not affect Discord's cached configuration or key.
 *
 * Format: `key-id=base64url-32-byte-key,key-id-2=base64url-32-byte-key`.
 * Key material must come from the deployment secret manager; KOMU never
 * generates or logs it.
 */
function keyring(): Map<string, TikTokKey> {
  const value = process.env[TIKTOK_KEYRING_ENV];
  const active = process.env[TIKTOK_ACTIVE_KEY_ENV];

  if (!value && !active) return new Map();
  if (!value || !active) throw new Error("TikTok encryption keyring is incomplete");

  const result = new Map<string, TikTokKey>();
  for (const entry of value.split(",")) {
    const [id, encoded, ...extra] = entry.split("=");
    if (
      extra.length > 0 ||
      !id ||
      !/^[A-Za-z0-9_-]{1,32}$/.test(id) ||
      !encoded ||
      !/^[A-Za-z0-9_-]{43}$/.test(encoded) ||
      result.has(id)
    ) {
      throw new Error("TikTok encryption keyring is invalid");
    }

    const material = Buffer.from(encoded, "base64url");
    if (material.length !== KEY_BYTES) {
      throw new Error("TikTok encryption keyring is invalid");
    }
    result.set(id, { id, material });
  }

  if (!result.has(active)) throw new Error("TikTok active encryption key is unavailable");
  return result;
}

function rotatedEncryptionKey(key: TikTokKey): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      key.material,
      "komu",
      `tiktok-oauth-token:v2:${key.id}`,
      KEY_BYTES,
    ),
  );
}

function activeRotatedKey(): TikTokKey | null {
  const active = process.env[TIKTOK_ACTIVE_KEY_ENV];
  if (!active) return null;
  return keyring().get(active) ?? null;
}

export function activeTikTokEncryptionKeyId(): string | null {
  return activeRotatedKey()?.id ?? null;
}

export function isTikTokTokenUsingActiveKey(stored: string): boolean {
  const active = activeTikTokEncryptionKeyId();
  return active
    ? stored.startsWith(`${TIKTOK_ROTATED_TOKEN_PREFIX}:${active}:`)
    : stored.startsWith(`${TIKTOK_TOKEN_PREFIX}:`);
}

export function encryptTikTokToken(plaintext: string): string {
  if (!plaintext) throw new Error("TikTok token must not be empty");

  const rotatedKey = activeRotatedKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(
    ALGORITHM,
    rotatedKey ? rotatedEncryptionKey(rotatedKey) : encryptionKey(),
    iv,
  );
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return rotatedKey
    ? [
        TIKTOK_ROTATED_TOKEN_PREFIX,
        rotatedKey.id,
        iv.toString("base64url"),
        cipher.getAuthTag().toString("base64url"),
        ciphertext.toString("base64url"),
      ].join(":")
    : [
        TIKTOK_TOKEN_PREFIX,
        iv.toString("base64url"),
        cipher.getAuthTag().toString("base64url"),
        ciphertext.toString("base64url"),
      ].join(":");
}

/** Return null for plaintext, malformed, or tampered TikTok rows. */
export function decryptTikTokToken(stored: string): string | null {
  const parts = stored.split(":");

  if (parts.length === 5 && `${parts[0]}:${parts[1]}` === TIKTOK_TOKEN_PREFIX) {
    return decryptWithKey(parts[2], parts[3], parts[4], encryptionKey());
  }

  if (
    parts.length === 6 &&
    `${parts[0]}:${parts[1]}` === TIKTOK_ROTATED_TOKEN_PREFIX
  ) {
    const key = keyring().get(parts[2]);
    return key
      ? decryptWithKey(parts[3], parts[4], parts[5], rotatedEncryptionKey(key))
      : null;
  }

  return null;
}

export function isEncryptedTikTokToken(stored: string): boolean {
  return (
    stored.startsWith(`${TIKTOK_TOKEN_PREFIX}:`) ||
    stored.startsWith(`${TIKTOK_ROTATED_TOKEN_PREFIX}:`)
  );
}

/** Re-encrypt a TikTok token under the configured active key, if any. */
export function reencryptTikTokToken(stored: string): string | null {
  const plaintext = decryptTikTokToken(stored);
  if (!plaintext) return null;
  return activeRotatedKey() ? encryptTikTokToken(plaintext) : stored;
}

function decryptWithKey(
  iv: string,
  tag: string,
  ciphertext: string,
  key: Buffer,
): string | null {
  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");

    return plaintext || null;
  } catch {
    return null;
  }
}
