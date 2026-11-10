import "server-only";

import { randomBytes } from "node:crypto";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  decryptTikTokToken,
  encryptTikTokToken,
} from "@/lib/auth/provider-token-crypto";
import type { TikTokOAuthConfig } from "./config";
import {
  revokeTikTokAccessToken,
  safeTikTokErrorCategory,
  type TikTokTokenResponse,
  type TikTokUserInfo,
} from "./oauth";

export const TIKTOK_REVOCATION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const TIKTOK_DISCONNECT_LEASE_MS = 30_000;
export const TIKTOK_REVOCATION_LEASE_MS = 30_000;

export class TikTokConnectionBusyError extends Error {
  readonly code = "connection_busy";

  constructor() {
    super("TikTok connection is busy");
    this.name = "TikTokConnectionBusyError";
  }
}

export class TikTokRelinkBlockedError extends Error {
  readonly code = "relink_blocked";

  constructor() {
    super("TikTok credentials require safe recovery before relinking");
    this.name = "TikTokRelinkBlockedError";
  }
}

export interface TikTokConnectionView {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  grantedScopes: string[];
  videoNotificationsEnabled: boolean;
  reauthorizationRequiredAt: Date | null;
  disconnectedAt: Date | null;
  revocationPendingAt: Date | null;
}

type ExistingTikTokConnection = {
  id: string;
  guildId: string;
  accessToken: string | null;
  refreshToken: string | null;
  credentialsVersion: number;
  refreshLeaseToken: string | null;
  refreshLeaseUntil: Date | null;
  disconnectLeaseToken: string | null;
  disconnectLeaseUntil: Date | null;
  disconnectedAt: Date | null;
};

/** Persist only fields returned by the currently approved basic scope. */
export async function saveTikTokConnection(input: {
  guildId: string;
  connectedByUserId: string;
  token: TikTokTokenResponse;
  userInfo: TikTokUserInfo;
}): Promise<void> {
  const now = new Date();
  const accessToken = encryptTikTokToken(input.token.access_token);
  const refreshToken = encryptTikTokToken(input.token.refresh_token);
  const grantedScopes = input.token.scope
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.tikTokConnection.findUnique({
      where: { guildId: input.guildId },
      select: {
        id: true,
        guildId: true,
        accessToken: true,
        refreshToken: true,
        credentialsVersion: true,
        refreshLeaseToken: true,
        refreshLeaseUntil: true,
        disconnectLeaseToken: true,
        disconnectLeaseUntil: true,
        disconnectedAt: true,
      },
    });

    if (!existing) {
      await tx.tikTokConnection.create({
        data: {
          guildId: input.guildId,
          connectedByUserId: input.connectedByUserId,
          openId: input.token.open_id,
          displayName: input.userInfo.display_name,
          avatarUrl: input.userInfo.avatar_url,
          accessToken,
          refreshToken,
          accessTokenExpiresAt: new Date(now.getTime() + input.token.expires_in * 1000),
          refreshTokenExpiresAt: new Date(
            now.getTime() + input.token.refresh_expires_in * 1000,
          ),
          grantedScopes,
          videoNotificationsEnabled: false,
          credentialsVersion: 1,
          disconnectLeaseToken: null,
          disconnectLeaseUntil: null,
          reauthorizationRequiredAt: null,
          disconnectedAt: null,
        },
      });
      return;
    }

    assertRelinkSafe(existing, now);
    await preservePreviousAccessToken(tx, existing, now);

    const updated = await tx.tikTokConnection.updateMany({
      where: {
        id: existing.id,
        guildId: input.guildId,
        credentialsVersion: existing.credentialsVersion,
        AND: [
          {
            OR: [
              { refreshLeaseToken: null },
              { refreshLeaseUntil: { lte: now } },
            ],
          },
          {
            OR: [
              { disconnectLeaseToken: null, disconnectLeaseUntil: null },
              { disconnectLeaseUntil: { lte: now } },
            ],
          },
        ],
      },
      data: {
        connectedByUserId: input.connectedByUserId,
        openId: input.token.open_id,
        displayName: input.userInfo.display_name,
        avatarUrl: input.userInfo.avatar_url,
        accessToken,
        refreshToken,
        accessTokenExpiresAt: new Date(now.getTime() + input.token.expires_in * 1000),
        refreshTokenExpiresAt: new Date(
          now.getTime() + input.token.refresh_expires_in * 1000,
        ),
        grantedScopes,
        // Relinking increments the version and explicitly clears old state.
        // Any old access token was queued above before this write.
        videoNotificationsEnabled: false,
        credentialsVersion: { increment: 1 },
        refreshLeaseToken: null,
        refreshLeaseUntil: null,
        lastRefreshAttemptAt: null,
        disconnectLeaseToken: null,
        disconnectLeaseUntil: null,
        reauthorizationRequiredAt: null,
        disconnectedAt: null,
      },
    });

    if (updated.count !== 1) throw new TikTokConnectionBusyError();
  });
}

function assertRelinkSafe(
  connection: ExistingTikTokConnection,
  now: Date,
): void {
  if (
    (connection.disconnectLeaseToken &&
      (!connection.disconnectLeaseUntil || connection.disconnectLeaseUntil > now)) ||
    (!connection.disconnectLeaseToken && connection.disconnectLeaseUntil) ||
    (connection.refreshLeaseToken &&
      (!connection.refreshLeaseUntil || connection.refreshLeaseUntil > now)) ||
    (!connection.refreshLeaseToken && connection.refreshLeaseUntil)
  ) {
    throw new TikTokConnectionBusyError();
  }
}

/** Queue the old access token before any relink can replace it. */
async function preservePreviousAccessToken(
  tx: Prisma.TransactionClient,
  connection: ExistingTikTokConnection,
  now: Date,
): Promise<void> {
  if (!connection.accessToken && connection.refreshToken) {
    throw new TikTokRelinkBlockedError();
  }
  if (!connection.accessToken) return;

  // Verify the ciphertext before queuing it. The queue stores ciphertext only;
  // a corrupt row is blocked rather than silently overwritten.
  if (!decryptTikTokToken(connection.accessToken)) {
    throw new TikTokRelinkBlockedError();
  }

  await tx.tikTokRevocation.upsert({
    where: {
      connectionId_sourceCredentialsVersion: {
        connectionId: connection.id,
        sourceCredentialsVersion: connection.credentialsVersion,
      },
    },
    create: {
      guildId: connection.guildId,
      connectionId: connection.id,
      sourceCredentialsVersion: connection.credentialsVersion,
      accessToken: connection.accessToken,
      retentionUntil: new Date(now.getTime() + TIKTOK_REVOCATION_RETENTION_MS),
    },
    update: {},
  });
}

export async function getTikTokConnectionForGuild(
  guildId: string,
): Promise<TikTokConnectionView | null> {
  const connection = await prisma.tikTokConnection.findUnique({
    where: { guildId },
    select: {
      id: true,
      displayName: true,
      avatarUrl: true,
      grantedScopes: true,
      videoNotificationsEnabled: true,
      reauthorizationRequiredAt: true,
      disconnectedAt: true,
    },
  });

  if (!connection || connection.disconnectedAt) return null;

  const pending = await prisma.tikTokRevocation.findFirst({
    where: {
      connectionId: connection.id,
      retentionUntil: { gt: new Date() },
    },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });

  return { ...connection, revocationPendingAt: pending?.createdAt ?? null };
}

export type TikTokDisconnectResult =
  | { ok: true; revocationConfirmed: true }
  | {
      ok: false;
      error: "not_connected" | "revocation_unconfirmed" | "operation_in_progress";
    };

/**
 * Claim the connection, revoke outside the database, then finalize with the
 * original credential version and lease token. A delayed operation can only
 * affect the row it claimed; a relink increments the version and makes every
 * stale write fail.
 */
export async function disconnectTikTokConnection(input: {
  guildId: string;
  connectionId: string;
  config: TikTokOAuthConfig;
}): Promise<TikTokDisconnectResult> {
  const existing = await prisma.tikTokConnection.findUnique({
    where: { id: input.connectionId },
    select: {
      id: true,
      guildId: true,
      accessToken: true,
      refreshToken: true,
      credentialsVersion: true,
      refreshLeaseToken: true,
      refreshLeaseUntil: true,
      disconnectLeaseToken: true,
      disconnectLeaseUntil: true,
      disconnectedAt: true,
    },
  });

  if (!existing || existing.guildId !== input.guildId || existing.disconnectedAt) {
    return { ok: false, error: "not_connected" };
  }

  const now = new Date();
  if (
    (existing.disconnectLeaseToken &&
      (!existing.disconnectLeaseUntil || existing.disconnectLeaseUntil > now)) ||
    (!existing.disconnectLeaseToken && existing.disconnectLeaseUntil) ||
    (existing.refreshLeaseToken &&
      (!existing.refreshLeaseUntil || existing.refreshLeaseUntil > now)) ||
    (!existing.refreshLeaseToken && existing.refreshLeaseUntil)
  ) {
    return { ok: false, error: "operation_in_progress" };
  }

  const leaseToken = randomBytes(24).toString("base64url");
  const leaseUntil = new Date(now.getTime() + TIKTOK_DISCONNECT_LEASE_MS);
  const claimed = await prisma.tikTokConnection.updateMany({
    where: {
      id: existing.id,
      guildId: input.guildId,
      credentialsVersion: existing.credentialsVersion,
      disconnectedAt: null,
      AND: [
        {
          OR: [
            { refreshLeaseToken: null },
            { refreshLeaseUntil: { lte: now } },
          ],
        },
        {
          OR: [
            { disconnectLeaseToken: null, disconnectLeaseUntil: null },
            { disconnectLeaseUntil: { lte: now } },
          ],
        },
      ],
    },
    data: {
      disconnectLeaseToken: leaseToken,
      disconnectLeaseUntil: leaseUntil,
    },
  });

  if (claimed.count !== 1) {
    return { ok: false, error: "operation_in_progress" };
  }

  const accessToken = existing.accessToken
    ? decryptTikTokToken(existing.accessToken)
    : null;

  if (!accessToken) {
    await finalizeUnconfirmedDisconnect({
      ...input,
      version: existing.credentialsVersion,
      leaseToken,
      encryptedAccessToken: existing.accessToken,
      errorCategory: "encryption_failure",
    });
    return { ok: false, error: "revocation_unconfirmed" };
  }

  try {
    await revokeTikTokAccessToken(accessToken, input.config);
  } catch (error) {
    const finalized = await finalizeUnconfirmedDisconnect({
      ...input,
      version: existing.credentialsVersion,
      leaseToken,
      encryptedAccessToken: existing.accessToken,
      errorCategory: safeTikTokErrorCategory(error),
    });
    return finalized
      ? { ok: false, error: "revocation_unconfirmed" }
      : { ok: false, error: "operation_in_progress" };
  }

  const finalized = await finalizeConfirmedDisconnect({
    ...input,
    version: existing.credentialsVersion,
    leaseToken,
  });
  return finalized
    ? { ok: true, revocationConfirmed: true }
    : { ok: false, error: "operation_in_progress" };
}

async function finalizeConfirmedDisconnect(input: {
  guildId: string;
  connectionId: string;
  version: number;
  leaseToken: string;
}): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const result = await tx.tikTokConnection.updateMany({
      where: {
        id: input.connectionId,
        guildId: input.guildId,
        credentialsVersion: input.version,
        disconnectLeaseToken: input.leaseToken,
        disconnectedAt: null,
      },
      data: {
        accessToken: null,
        refreshToken: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        refreshLeaseToken: null,
        refreshLeaseUntil: null,
        disconnectLeaseToken: null,
        disconnectLeaseUntil: null,
        reauthorizationRequiredAt: null,
        disconnectedAt: new Date(),
        credentialsVersion: { increment: 1 },
      },
    });

    if (result.count === 1) return true;

    // The external revoke succeeded. Remove only the queue entry for the
    // exact credential version; never touch a newer connection row.
    await tx.tikTokRevocation.deleteMany({
      where: {
        connectionId: input.connectionId,
        sourceCredentialsVersion: input.version,
      },
    });
    return false;
  });
}

async function finalizeUnconfirmedDisconnect(input: {
  guildId: string;
  connectionId: string;
  version: number;
  leaseToken: string;
  encryptedAccessToken: string | null;
  errorCategory: string;
}): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const result = await tx.tikTokConnection.updateMany({
      where: {
        id: input.connectionId,
        guildId: input.guildId,
        credentialsVersion: input.version,
        disconnectLeaseToken: input.leaseToken,
        disconnectedAt: null,
      },
      data: {
        accessToken: null,
        refreshToken: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        refreshLeaseToken: null,
        refreshLeaseUntil: null,
        disconnectLeaseToken: null,
        disconnectLeaseUntil: null,
        reauthorizationRequiredAt: now,
        disconnectedAt: now,
        credentialsVersion: { increment: 1 },
      },
    });

    if (result.count !== 1) return false;

    if (input.encryptedAccessToken) {
      await tx.tikTokRevocation.upsert({
        where: {
          connectionId_sourceCredentialsVersion: {
            connectionId: input.connectionId,
            sourceCredentialsVersion: input.version,
          },
        },
        create: {
          guildId: input.guildId,
          connectionId: input.connectionId,
          sourceCredentialsVersion: input.version,
          accessToken: input.encryptedAccessToken,
          retentionUntil: new Date(now.getTime() + TIKTOK_REVOCATION_RETENTION_MS),
          lastAttemptAt: now,
          lastErrorCategory: input.errorCategory,
        },
        update: {
          lastAttemptAt: now,
          lastErrorCategory: input.errorCategory,
          leaseToken: null,
          leaseUntil: null,
        },
      });
    }

    return true;
  });
}

export async function purgeExpiredTikTokRevocationCredentials(
  now = new Date(),
): Promise<number> {
  const result = await prisma.tikTokRevocation.deleteMany({
    where: {
      retentionUntil: { lte: now },
      OR: [
        { leaseToken: null },
        { leaseUntil: null },
        { leaseUntil: { lte: now } },
      ],
    },
  });
  return result.count;
}

export interface TikTokRevocationMaintenanceResult {
  claimed: number;
  revoked: number;
  failed: number;
  purged: number;
}

/** Run bounded, idempotent revocation retries outside database transactions. */
export async function runTikTokRevocationMaintenance(
  config: TikTokOAuthConfig,
  options: {
    now?: () => Date;
    maxItems?: number;
    revoke?: (accessToken: string, config: TikTokOAuthConfig) => Promise<void>;
  } = {},
): Promise<TikTokRevocationMaintenanceResult> {
  const now = options.now ?? (() => new Date());
  const current = now();
  const maxItems = Math.max(1, Math.min(options.maxItems ?? 10, 50));
  const revoke = options.revoke ?? revokeTikTokAccessToken;
  const purged = await purgeExpiredTikTokRevocationCredentials(current);
  const candidates = await prisma.tikTokRevocation.findMany({
    where: {
      retentionUntil: { gt: current },
      OR: [
        { leaseToken: null },
        { leaseUntil: { lte: current } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: maxItems,
    select: { id: true, accessToken: true },
  });

  let claimed = 0;
  let revoked = 0;
  let failed = 0;

  for (const candidate of candidates) {
    const leaseToken = randomBytes(24).toString("base64url");
    const leaseUntil = new Date(current.getTime() + TIKTOK_REVOCATION_LEASE_MS);
    const claim = await prisma.tikTokRevocation.updateMany({
      where: {
        id: candidate.id,
        retentionUntil: { gt: current },
        OR: [
          { leaseToken: null },
          { leaseUntil: { lte: current } },
        ],
      },
      data: { leaseToken, leaseUntil, lastAttemptAt: current },
    });
    if (claim.count !== 1) continue;
    claimed += 1;

    const accessToken = decryptTikTokToken(candidate.accessToken);
    if (!accessToken) {
      failed += 1;
      await prisma.tikTokRevocation.updateMany({
        where: { id: candidate.id, leaseToken },
        data: {
          leaseToken: null,
          leaseUntil: null,
          lastErrorCategory: "encryption_failure",
        },
      });
      continue;
    }

    try {
      await revoke(accessToken, config);
      await prisma.tikTokRevocation.deleteMany({
        where: { id: candidate.id, leaseToken },
      });
      revoked += 1;
    } catch (error) {
      failed += 1;
      await prisma.tikTokRevocation.updateMany({
        where: { id: candidate.id, leaseToken },
        data: {
          leaseToken: null,
          leaseUntil: null,
          lastErrorCategory: safeTikTokErrorCategory(error),
        },
      });
    }
  }

  return { claimed, revoked, failed, purged };
}
