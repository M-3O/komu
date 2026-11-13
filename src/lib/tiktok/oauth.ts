import "server-only";

import { fetchWithTimeout } from "@/lib/http/fetch-with-timeout";
import {
  TIKTOK_REQUIRED_SCOPE,
  isTikTokAllowedScope,
  type TikTokOAuthConfig,
} from "./config";

export const TIKTOK_AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
export const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
export const TIKTOK_REVOKE_URL = "https://open.tiktokapis.com/v2/oauth/revoke/";
export const TIKTOK_USER_INFO_URL = "https://open.tiktokapis.com/v2/user/info/";

export interface TikTokTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
  open_id: string;
  scope: string;
  token_type: "Bearer";
}

export interface TikTokUserInfo {
  open_id: string;
  display_name: string | null;
  avatar_url: string | null;
}

export class TikTokApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly logId: string | null;

  constructor(input: {
    code: string;
    status: number;
    logId?: string | null;
  }) {
    super("TikTok API request failed");
    this.name = "TikTokApiError";
    this.code = input.code;
    this.status = input.status;
    this.logId = input.logId ?? null;
  }
}

export type TikTokSafeErrorCategory =
  | "access_denied"
  | "invalid_client"
  | "invalid_grant"
  | "invalid_request"
  | "invalid_scope"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "unsupported_response_type"
  | "server_error"
  | "temporarily_unavailable"
  | "invalid_token"
  | "malformed_response"
  | "http_error"
  | "provider_error"
  | "internal_error";

const SAFE_PROVIDER_ERROR_CATEGORIES = new Set<TikTokSafeErrorCategory>([
  "access_denied",
  "invalid_client",
  "invalid_grant",
  "invalid_request",
  "invalid_scope",
  "unauthorized_client",
  "unsupported_grant_type",
  "unsupported_response_type",
  "server_error",
  "temporarily_unavailable",
  "invalid_token",
  "malformed_response",
  "http_error",
]);

/** Convert provider-controlled error text to a fixed safe log category. */
export function safeTikTokErrorCategory(
  error: unknown,
): TikTokSafeErrorCategory {
  if (!(error instanceof TikTokApiError)) return "internal_error";
  return SAFE_PROVIDER_ERROR_CATEGORIES.has(error.code as TikTokSafeErrorCategory)
    ? (error.code as TikTokSafeErrorCategory)
    : "provider_error";
}

export function buildTikTokAuthorizeUrl(
  config: TikTokOAuthConfig,
  state: string,
  requestedScopes: readonly string[],
): string {
  if (
    requestedScopes.length === 0 ||
    !requestedScopes.every((scope) => isTikTokAllowedScope(scope)) ||
    !requestedScopes.includes(TIKTOK_REQUIRED_SCOPE)
  ) {
    throw new Error("TikTok authorization requested an unsupported scope");
  }

  const url = new URL(TIKTOK_AUTHORIZE_URL);
  url.searchParams.set("client_key", config.clientKey);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", requestedScopes.join(","));
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

export function parseTikTokScopes(value: string | null | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean),
  );
}

export function validateTikTokScopes(
  grantedScopes: Iterable<string>,
  requestedScopes: readonly string[],
): {
  valid: boolean;
  requiredGranted: boolean;
  optionalMissing: string[];
  invalidRequested: string[];
  unexpectedGranted: string[];
} {
  const granted = new Set(grantedScopes);
  const requested = [...new Set(requestedScopes)];
  const invalidRequested = requested.filter((scope) => !isTikTokAllowedScope(scope));
  const unexpectedGranted = [...granted].filter((scope) => !isTikTokAllowedScope(scope));
  const requiredGranted = granted.has(TIKTOK_REQUIRED_SCOPE);

  return {
    valid: invalidRequested.length === 0 && unexpectedGranted.length === 0,
    requiredGranted,
    optionalMissing: requested.filter(
      (scope) => scope !== TIKTOK_REQUIRED_SCOPE && !granted.has(scope),
    ),
    invalidRequested,
    unexpectedGranted,
  };
}

export async function exchangeTikTokCode(
  code: string,
  config: TikTokOAuthConfig,
): Promise<TikTokTokenResponse> {
  return requestToken(config, {
    client_key: config.clientKey,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
  });
}

export async function refreshTikTokAccessToken(
  refreshToken: string,
  config: TikTokOAuthConfig,
): Promise<TikTokTokenResponse> {
  return requestToken(config, {
    client_key: config.clientKey,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

export async function revokeTikTokAccessToken(
  accessToken: string,
  config: TikTokOAuthConfig,
): Promise<void> {
  const response = await fetchWithTimeout(TIKTOK_REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({
      client_key: config.clientKey,
      client_secret: config.clientSecret,
      token: accessToken,
    }),
  });

  if (!response.ok) {
    throw await toTikTokApiError(response);
  }
}

export async function fetchTikTokUserInfo(
  accessToken: string,
): Promise<TikTokUserInfo> {
  const url = new URL(TIKTOK_USER_INFO_URL);
  url.searchParams.set("fields", "open_id,display_name,avatar_url");

  const response = await fetchWithTimeout(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const payload = await readJson(response);

  if (!response.ok || !isRecord(payload) || !isRecord(payload.data)) {
    throw toTikTokApiErrorFromPayload(response.status, payload);
  }

  if (typeof payload.error === "string" && payload.error.length > 0) {
    throw toTikTokApiErrorFromPayload(response.status, payload);
  }

  const user = payload.data.user;
  if (!isRecord(user) || typeof user.open_id !== "string") {
    throw new TikTokApiError({ code: "malformed_response", status: response.status });
  }

  return {
    open_id: user.open_id,
    display_name: typeof user.display_name === "string" ? user.display_name : null,
    avatar_url: typeof user.avatar_url === "string" ? user.avatar_url : null,
  };
}

async function requestToken(
  config: TikTokOAuthConfig,
  values: Record<string, string>,
): Promise<TikTokTokenResponse> {
  const response = await fetchWithTimeout(TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody(values),
  });

  const payload = await readJson(response);

  if (!response.ok) {
    throw toTikTokApiErrorFromPayload(response.status, payload);
  }

  if (isRecord(payload) && typeof payload.error === "string") {
    throw toTikTokApiErrorFromPayload(response.status, payload);
  }

  if (!isTikTokTokenResponse(payload)) {
    throw new TikTokApiError({
      code: "malformed_response",
      status: response.status,
      logId: isRecord(payload) && typeof payload.log_id === "string"
        ? payload.log_id
        : null,
    });
  }

  return payload;
}

function formBody(values: Record<string, string>): string {
  return new URLSearchParams(values).toString();
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function toTikTokApiError(response: Response): Promise<TikTokApiError> {
  return toTikTokApiErrorFromPayload(response.status, await readJson(response));
}

function toTikTokApiErrorFromPayload(
  status: number,
  payload: unknown,
): TikTokApiError {
  const record = isRecord(payload) ? payload : {};
  return new TikTokApiError({
    code: typeof record.error === "string" ? record.error : "http_error",
    status,
    logId: typeof record.log_id === "string" ? record.log_id : null,
  });
}

function isTikTokTokenResponse(value: unknown): value is TikTokTokenResponse {
  if (!isRecord(value)) return false;

  return (
    typeof value.access_token === "string" &&
    value.access_token.trim().length > 0 &&
    isPositiveFiniteNumber(value.expires_in) &&
    typeof value.refresh_token === "string" &&
    value.refresh_token.trim().length > 0 &&
    isPositiveFiniteNumber(value.refresh_expires_in) &&
    typeof value.open_id === "string" &&
    value.open_id.trim().length > 0 &&
    typeof value.scope === "string" &&
    value.scope.trim().length > 0 &&
    value.token_type === "Bearer"
  );
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
