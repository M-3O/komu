import type { DiscordGuildSummary } from "./discord-oauth";

/**
 * Discord permission checks.
 *
 * Discord sends `permissions` as a decimal string holding a bitfield.
 * Komu only needs one bit for setup: can this person administer the server?
 *
 * See https://discord.com/developers/docs/topics/permissions
 */

/** 1 << 3: Administrator. Grants every permission implicitly. */
const ADMINISTRATOR = 1 << 3;

/**
 * Whether a user may configure Komu for a server.
 *
 * Accepts the owner, or anyone with the Administrator permission. The plan
 * calls for an administrator/owner check (IMPLEMENTATION_PLAN Phase 2).
 */
export function canManageGuild(guild: DiscordGuildSummary): boolean {
  if (guild.owner) return true;

  const permissions = Number(guild.permissions);
  if (!Number.isFinite(permissions)) return false;

  return (permissions & ADMINISTRATOR) === ADMINISTRATOR;
}

/** The servers this user is allowed to set up. */
export function manageableGuilds(
  guilds: DiscordGuildSummary[],
): DiscordGuildSummary[] {
  return guilds.filter(canManageGuild);
}