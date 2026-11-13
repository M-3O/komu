import { createHash, randomBytes } from "node:crypto";

export const TIKTOK_OAUTH_STATE_TTL_SECONDS = 600;

export interface TikTokOAuthStateInput {
  userId: string;
  guildId: string;
  requestedScopes: readonly string[];
  redirectUri: string;
  now?: number;
}

export interface TikTokOAuthState {
  state: string;
  stateHash: string;
  userId: string;
  guildId: string;
  requestedScopes: string[];
  redirectUri: string;
  expiresAt: Date;
}

/**
 * Generate an opaque state value. The raw value is never persisted by KOMU;
 * only its SHA-256 digest is written to the shared database record.
 */
export function createTikTokOAuthState(
  input: TikTokOAuthStateInput,
): TikTokOAuthState {
  const state = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    (input.now ?? Date.now()) + TIKTOK_OAUTH_STATE_TTL_SECONDS * 1000,
  );

  return {
    state,
    stateHash: hashTikTokOAuthState(state),
    userId: input.userId,
    guildId: input.guildId,
    requestedScopes: [...input.requestedScopes],
    redirectUri: input.redirectUri,
    expiresAt,
  };
}

export function hashTikTokOAuthState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

/** Provider state must remain a bounded URL-safe opaque value. */
export function isValidTikTokOAuthState(state: string | null): state is string {
  return Boolean(state && state.length === 43 && /^[A-Za-z0-9_-]+$/.test(state));
}
