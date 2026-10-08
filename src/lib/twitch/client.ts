import "server-only";

import { createLogger } from "@/lib/logger";
import type { TwitchListResponse, TwitchStreamResponse, TwitchUserResponse } from "./types";

/**
 * Thin Twitch Helix client.
 *
 * Knows about authentication, rate limits and error shapes. Knows nothing
 * about streams, which is handled in `provider.ts`.
 *
 * Uses an app access token rather than a user token: reading whether a
 * channel is live needs no user authorisation, so the creator never has to
 * grant Komu access to their account.
 */

const HELIX_BASE = "https://api.twitch.tv/helix";
const TOKEN_URL = "https://id.twitch.tv/oauth2/token";

/** Twitch rate limits are reported in requests per minute. */
const RATE_LIMIT_STATUS = 429;

const log = createLogger("stream");

let cachedToken: { value: string; expiresAt: number } | null = null;
/** Guards against a burst of concurrent callers each fetching a token. */
let inFlightToken: Promise<string> | null = null;

/** Thrown when Twitch cannot be reached or refuses the request. */
export class TwitchApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "TwitchApiError";
  }
}

function getCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new TwitchApiError(
      "Twitch is not configured. Add TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET to .env.local.",
      undefined,
      "NOT_CONFIGURED",
    );
  }

  return { clientId, clientSecret };
}

/**
 * Get an app access token, reusing the cached one until it expires.
 *
 * Twitch app tokens do not normally expire, but the response may carry an
 * expiry, and honouring it avoids a token that stops working after a Twitch
 * side change.
 */
async function getAppAccessToken(): Promise<string> {
  const now = Date.now();

  if (cachedToken && cachedToken.expiresAt > now) {
    return cachedToken.value;
  }

  if (inFlightToken) return inFlightToken;

  inFlightToken = (async () => {
    const { clientId, clientSecret } = getCredentials();

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
      }),
    });

    if (!response.ok) {
      log.error("Twitch token request failed", { status: response.status });
      throw new TwitchApiError(
        "Could not authenticate with Twitch.",
        response.status,
        "TOKEN_FAILED",
      );
    }

    const body = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };

    if (!body.access_token) {
      throw new TwitchApiError(
        "Twitch returned an unexpected token response.",
        response.status,
        "TOKEN_MALFORMED",
      );
    }

    // Refresh a little early so a token cannot expire mid-request.
    const lifetimeMs = (body.expires_in ?? 3600) * 1000;
    cachedToken = {
      value: body.access_token,
      expiresAt: Date.now() + Math.max(lifetimeMs - 60_000, 30_000),
    };

    return body.access_token;
  })();

  try {
    return await inFlightToken;
  } finally {
    inFlightToken = null;
  }
}

/** Perform an authenticated Helix request and return its `data` array. */
async function helixGet<T>(
  path: string,
  params: Record<string, string | string[]> = {},
): Promise<T[]> {
  const { clientId } = getCredentials();
  const token = await getAppAccessToken();

  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    // Twitch accepts repeated keys for multi-value filters.
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, item);
    } else {
      search.set(key, value);
    }
  }

  const url = `${HELIX_BASE}${path}${search.size > 0 ? `?${search}` : ""}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Client-Id": clientId,
    },
    // Stream status changes constantly; never serve a stale copy.
    cache: "no-store",
  });

  if (!response.ok) {
    if (response.status === RATE_LIMIT_STATUS) {
      log.warn("Twitch rate limit hit", { path });
      throw new TwitchApiError(
        "Twitch is rate limiting requests. Try again shortly.",
        response.status,
        "RATE_LIMITED",
      );
    }

    // The body can echo the client id or other config, so log only the status.
    log.error("Twitch request failed", {
      path,
      status: response.status,
    });

    throw new TwitchApiError(
      "Twitch could not be reached.",
      response.status,
      "REQUEST_FAILED",
    );
  }

  const body = (await response.json()) as TwitchListResponse<T>;

  return Array.isArray(body?.data) ? body.data : [];
}

/** Live streams for the given channel logins. Empty array means offline. */
export function getStreamsByLogin(
  logins: string[],
): Promise<TwitchStreamResponse[]> {
  if (logins.length === 0) return Promise.resolve([]);

  return helixGet<TwitchStreamResponse>("/streams", {
    user_login: logins,
    // Only "live" streams: the docs list "all" and "live", and "all" is the
    // default we do not want.
    type: "live",
  });
}

/** Live streams for the given Twitch user ids. */
export function getStreamsByUserId(
  userIds: string[],
): Promise<TwitchStreamResponse[]> {
  if (userIds.length === 0) return Promise.resolve([]);

  return helixGet<TwitchStreamResponse>("/streams", {
    user_id: userIds,
    type: "live",
  });
}

/** Look up one or more users by login name. */
export function getUsersByLogin(
  logins: string[],
): Promise<TwitchUserResponse[]> {
  if (logins.length === 0) return Promise.resolve([]);

  return helixGet<TwitchUserResponse>("/users", { login: logins });
}

/** Look up one or more users by Twitch user id. */
export function getUsersById(
  ids: string[],
): Promise<TwitchUserResponse[]> {
  if (ids.length === 0) return Promise.resolve([]);

  return helixGet<TwitchUserResponse>("/users", { id: ids });
}

/** Drop the cached token. Used by tests and by the reconnect path. */
export function resetTokenCache(): void {
  cachedToken = null;
  inFlightToken = null;
}