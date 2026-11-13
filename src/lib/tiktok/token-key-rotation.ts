import "server-only";

import { prisma } from "@/lib/db";
import {
  isTikTokTokenUsingActiveKey,
  reencryptTikTokToken,
} from "@/lib/auth/provider-token-crypto";

export interface TikTokKeyRotationResult {
  scanned: number;
  rotated: number;
  skipped: number;
  failed: number;
}

/**
 * Re-encrypt at most `limit` connection rows under the active TikTok key.
 * Every write is a credential-version CAS and skips active refresh/disconnect
 * leases. This is an approved operator action, not an automatic job.
 */
export async function reencryptTikTokConnectionTokens(options: {
  limit?: number;
} = {}): Promise<TikTokKeyRotationResult> {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const rows = await prisma.tikTokConnection.findMany({
    where: {
      OR: [{ accessToken: { not: null } }, { refreshToken: { not: null } }],
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: {
      id: true,
      credentialsVersion: true,
      accessToken: true,
      refreshToken: true,
      refreshLeaseToken: true,
      disconnectLeaseToken: true,
    },
  });

  let rotated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    if (row.refreshLeaseToken || row.disconnectLeaseToken) {
      skipped += 1;
      continue;
    }

    const accessToken = row.accessToken;
    const refreshToken = row.refreshToken;
    if (
      (accessToken && !isTikTokTokenUsingActiveKey(accessToken)) ||
      (refreshToken && !isTikTokTokenUsingActiveKey(refreshToken))
    ) {
      const rotatedAccess = accessToken
        ? reencryptTikTokToken(accessToken)
        : null;
      const rotatedRefresh = refreshToken
        ? reencryptTikTokToken(refreshToken)
        : null;

      if ((accessToken && !rotatedAccess) || (refreshToken && !rotatedRefresh)) {
        failed += 1;
        continue;
      }

      const result = await prisma.tikTokConnection.updateMany({
        where: {
          id: row.id,
          credentialsVersion: row.credentialsVersion,
          accessToken,
          refreshToken,
          refreshLeaseToken: null,
          disconnectLeaseToken: null,
        },
        data: {
          accessToken: rotatedAccess,
          refreshToken: rotatedRefresh,
          credentialsVersion: { increment: 1 },
        },
      });
      if (result.count === 1) rotated += 1;
      else skipped += 1;
    } else {
      skipped += 1;
    }
  }

  return { scanned: rows.length, rotated, skipped, failed };
}
