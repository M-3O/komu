import "server-only";

import { prisma } from "@/lib/db";
import {
  isTikTokAllowedScope,
  TIKTOK_REQUIRED_SCOPE,
} from "./config";
import {
  createTikTokOAuthState,
  hashTikTokOAuthState,
  type TikTokOAuthState,
} from "./oauth-state";

export interface ConsumedTikTokOAuthAttempt {
  id: string;
  userId: string;
  guildId: string;
  requestedScopes: string[];
  redirectUri: string;
  expiresAt: Date;
}

/** Create the shared, expiring attempt before leaving for TikTok. */
export async function createTikTokOAuthAttempt(
  input: Parameters<typeof createTikTokOAuthState>[0],
): Promise<TikTokOAuthState> {
  if (
    !input.requestedScopes.includes(TIKTOK_REQUIRED_SCOPE) ||
    !input.requestedScopes.every((scope) => isTikTokAllowedScope(scope))
  ) {
    throw new Error("TikTok OAuth attempt requested an unsupported scope");
  }

  const state = createTikTokOAuthState(input);

  // Opportunistic cleanup keeps short-lived OAuth metadata bounded even
  // before a scheduled maintenance job is introduced.
  await prisma.tikTokOAuthAttempt.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });

  await prisma.tikTokOAuthAttempt.create({
    data: {
      stateHash: state.stateHash,
      userId: state.userId,
      guildId: state.guildId,
      requestedScopes: state.requestedScopes,
      redirectUri: state.redirectUri,
      expiresAt: state.expiresAt,
    },
  });

  return state;
}

/**
 * Consume an attempt with one conditional database write. Two server
 * instances may read the same candidate, but only one can change
 * `consumedAt` from NULL; the other receives null and must not exchange code.
 */
export async function consumeTikTokOAuthAttempt(input: {
  state: string;
  userId: string;
  guildId: string;
  now?: Date;
}): Promise<ConsumedTikTokOAuthAttempt | null> {
  const now = input.now ?? new Date();
  const stateHash = hashTikTokOAuthState(input.state);
  const candidate = await prisma.tikTokOAuthAttempt.findUnique({
    where: { stateHash },
    select: {
      id: true,
      userId: true,
      guildId: true,
      requestedScopes: true,
      redirectUri: true,
      expiresAt: true,
    },
  });

  if (
    !candidate ||
    candidate.userId !== input.userId ||
    candidate.guildId !== input.guildId
  ) {
    return null;
  }

  const consumed = await prisma.tikTokOAuthAttempt.updateMany({
    where: {
      id: candidate.id,
      userId: input.userId,
      guildId: input.guildId,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    data: { consumedAt: now },
  });

  return consumed.count === 1 ? candidate : null;
}

/** Delete only expired attempt metadata; never delete an active attempt. */
export async function purgeExpiredTikTokOAuthAttempts(
  now = new Date(),
): Promise<number> {
  const result = await prisma.tikTokOAuthAttempt.deleteMany({
    where: { expiresAt: { lte: now } },
  });
  return result.count;
}
