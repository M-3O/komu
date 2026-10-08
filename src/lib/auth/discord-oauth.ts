import "server-only";

import { getDiscordRedirectUri, getServerConfig } from "@/lib/config/server-config";
import { createLogger } from "@/lib/logger";

/**
 * Discord OAuth: the three calls V1 needs.
 *
 *   1. Send the creator to Discord to authorise.
 *   2. Exchange the returned code for an access token.
 *   3. Read the user's identity and their guild list.
 *
 * `identify` gives us the user, `guilds` gives us the servers they can
 * administer. No bot permissions are required for any of this.
 */

const DISCORD_API_BASE = "https://discord.com/api/v10";
const DISCORD_OAUTH_BASE = "https://discord.com/oauth2";

const log = createLogger("auth");

/** Scopes: read the user, and read the servers they are in. */
const OAUTH_SCOPES = ["identify", "guilds"];

/** The subset of a guild we care about during setup. */
export interface DiscordGuildSummary {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  /** Decimal string bitfield, as Discord sends it. */
  permissions: string;
}

/** The subset of a Discord user we care about. */
export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

export interface DiscordTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope: string;
}

/**
 * Build the URL the browser is sent to in order to start the login flow.
 *
 * `state` is echoed back by Discord and checked in the callback to stop
 * another site from feeding us a forged authorization code.
 */
export function buildDiscordAuthorizeUrl(state: string): string {
  const { DISCORD_CLIENT_ID } = getServerConfig();

  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    response_type: "code",
    redirect_uri: getDiscordRedirectUri(),
    scope: OAUTH_SCOPES.join(" "),
    state,
  });

  return `${DISCORD_OAUTH_BASE}/authorize?${params.toString()}`;
}

/** Swap an authorization code for an access token. */
export async function exchangeCodeForToken(
  code: string,
): Promise<DiscordTokenResponse> {
  const { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET } = getServerConfig();

  const response = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: getDiscordRedirectUri(),
    }),
  });

  if (!response.ok) {
    // The response body may contain the client secret in rare misconfigured
    // cases, so log only the status.
    log.error("Discord token exchange failed", { status: response.status });
    throw new Error(
      "Could not complete Discord sign-in. Please try again.",
    );
  }

  return (await response.json()) as DiscordTokenResponse;
}

/** Read the authenticated Discord user. */
export async function fetchDiscordUser(
  accessToken: string,
): Promise<DiscordUser> {
  const response = await fetch(`${DISCORD_API_BASE}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    log.error("Discord user lookup failed", { status: response.status });
    throw new Error("Could not read your Discord profile. Please try again.");
  }

  return (await response.json()) as DiscordUser;
}

/**
 * Read every server the user is in.
 *
 * Note that `permissions` reflects the user's permissions in that server, so
 * it is the value to trust when deciding who may configure Komu.
 */
export async function fetchDiscordGuilds(
  accessToken: string,
): Promise<DiscordGuildSummary[]> {
  const response = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    log.error("Discord guild lookup failed", { status: response.status });
    throw new Error("Could not read your Discord servers. Please try again.");
  }

  const raw = (await response.json()) as Array<
    Record<string, unknown> & { id: string; name: string }
  >;

  return raw.map((guild) => ({
    id: guild.id,
    name: guild.name,
    icon: typeof guild.icon === "string" ? guild.icon : null,
    owner: guild.owner === true,
    permissions:
      typeof guild.permissions === "string" ? guild.permissions : "0",
  }));
}

/** URL of a guild icon, or null when the guild has none. */
export function guildIconUrl(
  guild: { id: string; icon: string | null },
): string | null {
  if (!guild.icon) return null;
  return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`;
}

/** URL of a user's avatar, or null when they have none. */
export function userAvatarUrl(
  user: { id: string; avatar: string | null },
): string | null {
  if (!user.avatar) return null;
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
}