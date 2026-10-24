import "server-only";

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { revokeDiscordToken } from "./discord-oauth";
import type { SessionPayload } from "./session-crypto";
import { decryptToken } from "./token-crypto";

/**
 * End a session everywhere, not just in this browser.
 *
 * Deleting the cookie signs this browser out, but a copied token stays valid
 * until it expires. Two things close that gap:
 *
 *   1. Bumping the user's session version invalidates every token issued
 *      before this moment, including one on another device.
 *   2. Revoking the Discord grant and clearing the stored token stops the
 *      access token itself from being reused.
 *
 * Both are best-effort. The cookie must be cleared even if Discord is down or
 * the user row has already been deleted, so failures are logged rather than
 * thrown.
 */

const log = createLogger("auth");

export async function endSession(session: SessionPayload): Promise<void> {
  let account: { accessToken: string | null } | null = null;

  try {
    account = await prisma.discordAccount.findUnique({
      where: { discordId: session.discordId },
      select: { accessToken: true },
    });
  } catch (error) {
    // The cookie still has to be cleared; nothing below can run without the
    // row, but the version bump still can.
    log.warn("Could not read the Discord token during sign-out", {
      discordId: session.discordId,
      reason: error instanceof Error ? error.message : "unknown",
    });
  }

  if (account?.accessToken) {
    const accessToken = decryptToken(account.accessToken);

    if (accessToken) {
      try {
        await revokeDiscordToken(accessToken);
      } catch (error) {
        log.warn("Could not revoke the Discord token", {
          discordId: session.discordId,
          reason: error instanceof Error ? error.message : "unknown",
        });
      }
    }

    try {
      await prisma.discordAccount.update({
        where: { discordId: session.discordId },
        data: { accessToken: null, tokenExpiresAt: null },
      });
    } catch (error) {
      log.warn("Could not clear the stored Discord token", {
        discordId: session.discordId,
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  try {
    await prisma.user.update({
      where: { id: session.userId },
      data: { sessionVersion: { increment: 1 } },
    });
  } catch (error) {
    // The row may already be gone; there is nothing left to revoke.
    log.warn("Could not bump the session version", {
      userId: session.userId,
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}
