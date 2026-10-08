import "server-only";

import { createLogger } from "@/lib/logger";
import type { KickChannel, KickEnvelope } from "./types";

/**
 * Thin Kick public API v1 client.
 *
 * Authenticated with the application's client credentials, so the creator never
 * has to connect their Kick account. Kick issues a bearer token from the client
 * id and secret, the same shape as the Twitch app token.
 *
 * Kick allows roughly two requests a second per IP, which is comfortably above
 * what the poller needs.
 */

const API_BASE = "https://api.kick.com/public/v1";
const TOKEN_URL = "https://id.kick.com/oauth/token";

/**
 * Read-only scopes.
 *
 * Neither `channel:write` nor anything that can act on the creator's account
 * is requested: Komu only ever asks whether a channel is live.
 */
const SCOPES = ["channel:read", "livestream:read"];

const RATE_LIMIT_STATUS = 429;

const log = createLogger("stream");

let cachedToken: { value: string; expiresAt: number } | null = null;
/** Guards against a burst of concurrent callers each fetching a token. */
let inFlightToken: Promise<string> | null = null;

/** Thrown when Kick cannot be reached or refuses the request. */
export class KickApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "KickApiError";
  }
}

function getCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.KICK_CLIENT_ID;
  const clientSecret = process.env.KICK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new KickApiError(
      "Kick is not configured. Add KICK_CLIENT_ID and KICK_CLIENT_SECRET to .env.local.",
      undefined,
      "NOT_CONFIGURED",
    );
  }

  return { clientId, clientSecret };
}

/** Get an access token, reusing the cached one until it expires. */
async function getAccessToken(): Promise<string> {
  const now = Date.now();

  if (cachedToken && cachedToken.expiresAt > now) {
    return cachedToken.value;
  }

  if (inFlightToken) return inFlightToken;

  inFlightToken = (async () => {
    const { clientId, clientSecret } = getCredentials();

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: SCOPES.join(" "),
      }),
    });

    if (!response.ok) {
      log.error("Kick token request failed", { status: response.status });
      throw new KickApiError(
        "Could not authenticate with Kick.",
        response.status,
        "TOKEN_FAILED",
      );
    }

    const body = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };

    if (!body.access_token) {
      throw new KickApiError(
        "Kick returned an unexpected token response.",
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

/** Perform an authenticated request and return the `data` envelope. */
async function apiGet<T>(path: string): Promise<T | null> {
  const token = await getAccessToken();

  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    // Live status changes constantly; never serve a stale copy.
    cache: "no-store",
  });

  if (response.status === RATE_LIMIT_STATUS) {
    log.warn("Kick rate limit hit", { path });
    throw new KickApiError(
      "Kick is rate limiting requests. Try again shortly.",
      response.status,
      "RATE_LIMITED",
    );
  }

  // Kick answers a missing channel with 404, which is a normal "no such
  // channel" rather than a failure worth surfacing.
  if (response.status === 404) return null;

  if (!response.ok) {
    log.error("Kick request failed", { path, status: response.status });
    throw new KickApiError("Kick could not be reached.", response.status, "REQUEST_FAILED");
  }

  const body = (await response.json()) as KickEnvelope<T>;

  // Kick sometimes answers 200 with an error envelope and no data. Treat that
  // as "nothing found" rather than crashing on an undefined read.
  if (!body?.data) return null;

  return body.data;
}

/** One channel by slug. Null when the channel does not exist. */
export function getChannel(slug: string): Promise<KickChannel | null> {
  return apiGet<KickChannel>(`/channels/${encodeURIComponent(slug)}`);
}

/** Drop the cached token. Used by tests and by the reconnect path. */
export function resetTokenCache(): void {
  cachedToken = null;
  inFlightToken = null;
}