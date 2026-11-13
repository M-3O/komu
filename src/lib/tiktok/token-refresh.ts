import "server-only";

import { randomBytes } from "node:crypto";

import { prisma } from "@/lib/db";
import {
  decryptTikTokToken,
  encryptTikTokToken,
} from "@/lib/auth/provider-token-crypto";
import type { TikTokOAuthConfig } from "./config";
import {
  parseTikTokScopes,
  refreshTikTokAccessToken,
  TikTokApiError,
  validateTikTokScopes,
  type TikTokTokenResponse,
} from "./oauth";

export const TIKTOK_REFRESH_SKEW_MS = 60_000;
export const TIKTOK_REFRESH_LEASE_MS = 30_000;
const MAX_REFRESH_WAIT_MS = 5_000;
const REFRESH_POLL_MS = 100;

export interface TikTokRefreshConnection {
  id: string;
  openId: string;
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  credentialsVersion: number;
  refreshLeaseToken: string | null;
  refreshLeaseUntil: Date | null;
  disconnectLeaseToken: string | null;
  disconnectLeaseUntil: Date | null;
  reauthorizationRequiredAt: Date | null;
  disconnectedAt: Date | null;
}

export interface TikTokRefreshStore {
  get(id: string): Promise<TikTokRefreshConnection | null>;
  claim(
    id: string,
    expectedVersion: number,
    leaseToken: string,
    leaseUntil: Date,
    now: Date,
  ): Promise<boolean>;
  markStaleLeaseUncertain(
    id: string,
    expectedVersion: number,
    leaseToken: string,
    now: Date,
  ): Promise<boolean>;
  markReauthorizationRequired(
    id: string,
    expectedVersion: number,
    leaseToken: string,
    now: Date,
  ): Promise<boolean>;
  markReauthorizationRequiredWithoutLease(
    id: string,
    expectedVersion: number,
    now: Date,
  ): Promise<boolean>;
  saveRotatedCredentials(input: {
    id: string;
    expectedVersion: number;
    leaseToken: string;
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: Date;
    refreshTokenExpiresAt: Date;
  }): Promise<boolean>;
}

export class TikTokReauthorizationRequiredError extends Error {
  readonly code = "reauthorization_required";

  constructor() {
    super("TikTok authorization must be completed again");
    this.name = "TikTokReauthorizationRequiredError";
  }
}

export class TikTokRefreshInProgressError extends Error {
  readonly code = "refresh_in_progress";

  constructor() {
    super("TikTok credentials are being refreshed");
    this.name = "TikTokRefreshInProgressError";
  }
}

export interface TikTokRefreshOptions {
  store?: TikTokRefreshStore;
  refresh?: (
    refreshToken: string,
    config: TikTokOAuthConfig,
  ) => Promise<TikTokTokenResponse>;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  maxWaitMs?: number;
}

/**
 * Refresh one connection without allowing multiple server replicas to spend
 * the same rotating refresh token. A lease expiry is treated as an uncertain
 * provider outcome, not as permission to retry with the old token.
 */
export async function refreshTikTokConnection(
  connectionId: string,
  config: TikTokOAuthConfig,
  options: TikTokRefreshOptions = {},
): Promise<string> {
  const store = options.store ?? prismaTikTokRefreshStore;
  const refresh = options.refresh ?? refreshTikTokAccessToken;
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? defaultSleep;
  const maxWaitMs = options.maxWaitMs ?? MAX_REFRESH_WAIT_MS;
  const deadline = now().getTime() + maxWaitMs;

  let claimed:
    | { connection: TikTokRefreshConnection; leaseToken: string }
    | undefined;

  while (!claimed) {
    const current = await store.get(connectionId);
    if (!current || current.disconnectedAt) {
      throw new TikTokReauthorizationRequiredError();
    }

    const currentTime = now();
    // A disconnect/relink operation owns the lifecycle while its lease is
    // present. Refresh must never spend credentials that may be revoked or
    // replaced by that operation, including after a crashed process leaves a
    // stale lease behind.
    if (current.disconnectLeaseToken || current.disconnectLeaseUntil) {
      throw new TikTokRefreshInProgressError();
    }
    if (current.reauthorizationRequiredAt) {
      throw new TikTokReauthorizationRequiredError();
    }

    if (
      current.refreshTokenExpiresAt &&
      current.refreshTokenExpiresAt <= currentTime
    ) {
      await store.markReauthorizationRequiredWithoutLease(
        current.id,
        current.credentialsVersion,
        currentTime,
      );
      throw new TikTokReauthorizationRequiredError();
    }

    if (
      !current.refreshTokenExpiresAt ||
      (current.refreshLeaseToken && !current.refreshLeaseUntil) ||
      (!current.refreshLeaseToken && current.refreshLeaseUntil)
    ) {
      await store.markReauthorizationRequiredWithoutLease(
        current.id,
        current.credentialsVersion,
        currentTime,
      );
      throw new TikTokReauthorizationRequiredError();
    }

    const usableAccessToken = readUsableAccessToken(current, currentTime);
    if (usableAccessToken) return usableAccessToken;

    if (current.refreshLeaseToken && current.refreshLeaseUntil) {
      if (current.refreshLeaseUntil > currentTime) {
        if (currentTime.getTime() >= deadline) {
          throw new TikTokRefreshInProgressError();
        }
        await sleep(Math.min(REFRESH_POLL_MS, deadline - currentTime.getTime()));
        continue;
      }

      // A crashed process may have completed the provider request after its
      // last durable write. Retrying the old rotating token could invalidate a
      // newer token, so permanently require a fresh authorization instead.
      await store.markStaleLeaseUncertain(
        current.id,
        current.credentialsVersion,
        current.refreshLeaseToken,
        currentTime,
      );
      throw new TikTokReauthorizationRequiredError();
    }

    const leaseToken = randomBytes(24).toString("base64url");
    const leaseUntil = new Date(
      currentTime.getTime() + TIKTOK_REFRESH_LEASE_MS,
    );
    const acquired = await store.claim(
      current.id,
      current.credentialsVersion,
      leaseToken,
      leaseUntil,
      currentTime,
    );

    if (acquired) {
      claimed = { connection: current, leaseToken };
      break;
    }

    // Another replica won the compare-and-swap. Re-read it rather than ever
    // calling TikTok with a refresh token that may already have rotated.
    if (now().getTime() >= deadline) {
      throw new TikTokRefreshInProgressError();
    }
    await sleep(REFRESH_POLL_MS);
  }

  const refreshToken = claimed.connection.refreshToken
    ? decryptTikTokToken(claimed.connection.refreshToken)
    : null;
  if (!refreshToken) {
    await store.markReauthorizationRequired(
      claimed.connection.id,
      claimed.connection.credentialsVersion,
      claimed.leaseToken,
      now(),
    );
    throw new TikTokReauthorizationRequiredError();
  }

  try {
    const token = await refresh(refreshToken, config);
    const refreshedScopes = parseTikTokScopes(token.scope);
    const scopeCheck = validateTikTokScopes(
      refreshedScopes,
      [...refreshedScopes],
    );

    if (
      token.open_id !== claimed.connection.openId ||
      !scopeCheck.valid ||
      !scopeCheck.requiredGranted
    ) {
      throw new TikTokReauthorizationRequiredError();
    }

    const refreshedAt = now();
    const saved = await store.saveRotatedCredentials({
      id: claimed.connection.id,
      expectedVersion: claimed.connection.credentialsVersion,
      leaseToken: claimed.leaseToken,
      accessToken: encryptTikTokToken(token.access_token),
      refreshToken: encryptTikTokToken(token.refresh_token),
      accessTokenExpiresAt: new Date(
        refreshedAt.getTime() + token.expires_in * 1000,
      ),
      refreshTokenExpiresAt: new Date(
        refreshedAt.getTime() + token.refresh_expires_in * 1000,
      ),
    });

    if (saved) return token.access_token;

    // A newer credential version won the CAS. Return it only if it is a
    // provably usable access token; never replace it with this older result.
    const latest = await store.get(claimed.connection.id);
    const latestAccessToken = latest &&
      !latest.disconnectedAt &&
      !latest.reauthorizationRequiredAt &&
      !latest.disconnectLeaseToken &&
      !latest.disconnectLeaseUntil
      ? readUsableAccessToken(latest, now())
      : null;
    if (latestAccessToken) return latestAccessToken;

    await store.markReauthorizationRequired(
      claimed.connection.id,
      claimed.connection.credentialsVersion,
      claimed.leaseToken,
      now(),
    );
    throw new TikTokReauthorizationRequiredError();
  } catch (error) {
    await store.markReauthorizationRequired(
      claimed.connection.id,
      claimed.connection.credentialsVersion,
      claimed.leaseToken,
      now(),
    );

    if (error instanceof TikTokReauthorizationRequiredError) throw error;
    // Any failed request can be ambiguous if the provider processed it before
    // the connection dropped. Do not retry a rotating token automatically.
    if (error instanceof TikTokApiError) {
      throw new TikTokReauthorizationRequiredError();
    }
    throw new TikTokReauthorizationRequiredError();
  }
}

function readUsableAccessToken(
  connection: TikTokRefreshConnection,
  now: Date,
): string | null {
  if (
    !connection.accessToken ||
    !connection.accessTokenExpiresAt ||
    connection.accessTokenExpiresAt.getTime() <=
      now.getTime() + TIKTOK_REFRESH_SKEW_MS
  ) {
    return null;
  }

  return decryptTikTokToken(connection.accessToken);
}

/**
 * The production adapter is exported so the disposable PostgreSQL suite can
 * exercise the same lease and credential-version predicates used by requests.
 * It does not expose tokens; all values remain inside the server-side store.
 */
export const prismaTikTokRefreshStore: TikTokRefreshStore = {
  async get(id) {
    return prisma.tikTokConnection.findUnique({
      where: { id },
      select: {
        id: true,
        openId: true,
        accessToken: true,
        refreshToken: true,
        accessTokenExpiresAt: true,
        refreshTokenExpiresAt: true,
        credentialsVersion: true,
        refreshLeaseToken: true,
        refreshLeaseUntil: true,
        disconnectLeaseToken: true,
        disconnectLeaseUntil: true,
        reauthorizationRequiredAt: true,
        disconnectedAt: true,
      },
    });
  },

  async claim(id, expectedVersion, leaseToken, leaseUntil, now) {
    const result = await prisma.tikTokConnection.updateMany({
      where: {
        id,
        credentialsVersion: expectedVersion,
        disconnectedAt: null,
        reauthorizationRequiredAt: null,
        disconnectLeaseToken: null,
        disconnectLeaseUntil: null,
        AND: [{
          OR: [
            { refreshLeaseToken: null },
            { refreshLeaseUntil: { lte: now } },
          ],
        }],
      },
      data: {
        refreshLeaseToken: leaseToken,
        refreshLeaseUntil: leaseUntil,
        lastRefreshAttemptAt: now,
      },
    });
    return result.count === 1;
  },

  async markStaleLeaseUncertain(id, expectedVersion, leaseToken, now) {
    const result = await prisma.tikTokConnection.updateMany({
      where: {
        id,
        credentialsVersion: expectedVersion,
        refreshLeaseToken: leaseToken,
        refreshLeaseUntil: { lte: now },
        reauthorizationRequiredAt: null,
        disconnectLeaseToken: null,
        disconnectLeaseUntil: null,
      },
      data: {
        reauthorizationRequiredAt: now,
        refreshLeaseToken: null,
        refreshLeaseUntil: null,
      },
    });
    return result.count === 1;
  },

  async markReauthorizationRequired(id, expectedVersion, leaseToken, now) {
    const result = await prisma.tikTokConnection.updateMany({
      where: {
        id,
        credentialsVersion: expectedVersion,
        refreshLeaseToken: leaseToken,
        disconnectLeaseToken: null,
        disconnectLeaseUntil: null,
      },
      data: {
        reauthorizationRequiredAt: now,
        refreshLeaseToken: null,
        refreshLeaseUntil: null,
      },
    });
    return result.count === 1;
  },

  async markReauthorizationRequiredWithoutLease(id, expectedVersion, now) {
    const result = await prisma.tikTokConnection.updateMany({
      where: {
        id,
        credentialsVersion: expectedVersion,
        reauthorizationRequiredAt: null,
        disconnectLeaseToken: null,
        disconnectLeaseUntil: null,
      },
      data: { reauthorizationRequiredAt: now },
    });
    return result.count === 1;
  },

  async saveRotatedCredentials(input) {
    const result = await prisma.tikTokConnection.updateMany({
      where: {
        id: input.id,
        credentialsVersion: input.expectedVersion,
        refreshLeaseToken: input.leaseToken,
        disconnectedAt: null,
        reauthorizationRequiredAt: null,
        disconnectLeaseToken: null,
        disconnectLeaseUntil: null,
      },
      data: {
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
        refreshTokenExpiresAt: input.refreshTokenExpiresAt,
        credentialsVersion: { increment: 1 },
        refreshLeaseToken: null,
        refreshLeaseUntil: null,
        reauthorizationRequiredAt: null,
      },
    });
    return result.count === 1;
  },
};

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
