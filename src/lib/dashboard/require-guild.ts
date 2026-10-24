import "server-only";

import {
  checkGuildAccess,
  getPrimaryGuild,
  requireCurrentUser,
} from "@/lib/auth/current-user";

export interface DashboardGuild {
  id: string;
  name: string;
  discordId: string;
}

export type DashboardGuildResult =
  | { ok: true; guild: DashboardGuild }
  | { ok: false; reason: "no-guild" | "denied" | "unavailable" };

/**
 * The connected server, once the caller is confirmed to administer it.
 *
 * Every dashboard action goes through here. The check this replaces confirmed
 * only that a session existed, then read the first guild in the table and
 * discarded the user id it had just fetched, so any signed-in Discord account
 * could rewrite the whole configuration. Whether someone may administer a
 * server is a question about the caller; "somebody is signed in" is not an
 * answer to it.
 *
 * `returnTo` is the page to come back to after signing in again.
 */
export async function resolveDashboardGuild(
  returnTo: string,
): Promise<DashboardGuildResult> {
  const user = await requireCurrentUser(returnTo);
  const guild = await getPrimaryGuild();

  if (!guild) return { ok: false, reason: "no-guild" };

  const access = await checkGuildAccess(user.userId, guild);

  if (access !== "granted") return { ok: false, reason: access };

  return {
    ok: true,
    guild: { id: guild.id, name: guild.name, discordId: guild.discordId },
  };
}

/**
 * The same, as a value or an error, for callers that cannot redirect.
 *
 * A Server Action reports a refusal as a thrown error because there is no
 * page to send them to; the dashboard layout redirects instead, using the
 * result directly.
 */
export async function requireGuild(returnTo: string): Promise<DashboardGuild> {
  const result = await resolveDashboardGuild(returnTo);

  if (result.ok) return result.guild;

  if (result.reason === "no-guild") {
    throw new Error(
      "No Discord server is connected yet. Finish setup before continuing.",
    );
  }

  if (result.reason === "denied") {
    throw new Error("You do not administer the connected Discord server.");
  }

  throw new Error(
    "Discord could not be reached, so your access could not be confirmed. Try again.",
  );
}
