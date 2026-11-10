import "server-only";

import { getServerConfig } from "@/lib/config/server-config";

export const TIKTOK_REQUIRED_SCOPE = "user.info.basic";
export const TIKTOK_VIDEO_SCOPE = "video.list";
export const TIKTOK_ALLOWED_SCOPES = [
  TIKTOK_REQUIRED_SCOPE,
  TIKTOK_VIDEO_SCOPE,
] as const;

export function isTikTokAllowedScope(
  scope: string,
): scope is (typeof TIKTOK_ALLOWED_SCOPES)[number] {
  return (TIKTOK_ALLOWED_SCOPES as readonly string[]).includes(scope);
}

// Keep the runtime gate closed until TikTok developer approval, the additive
// migration, and an explicit review of the local deployment configuration.
const TIKTOK_CONNECTION_STORAGE_READY = false;

export interface TikTokOAuthConfig {
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
}

export type TikTokIntegrationStatus =
  | { enabled: true; reason: "ready" }
  | {
      enabled: false;
      reason:
        | "feature_disabled"
        | "approval_required"
        | "credentials_missing"
        | "redirect_invalid"
        | "trusted_origin_missing";
    };

/**
 * TikTok is intentionally opt-in twice: the app must be approved and the
 * local feature flag must be enabled after the storage migration is reviewed.
 * Missing or invalid configuration never causes a partial OAuth flow.
 */
export function getTikTokIntegrationStatus(): TikTokIntegrationStatus {
  const config = getServerConfig();

  if (
    !TIKTOK_CONNECTION_STORAGE_READY ||
    config.TIKTOK_ACCOUNT_LINKING_ENABLED !== "true"
  ) {
    return { enabled: false, reason: "feature_disabled" };
  }

  if (config.TIKTOK_OAUTH_APPROVED !== "true") {
    return { enabled: false, reason: "approval_required" };
  }

  if (!config.TIKTOK_CLIENT_KEY || !config.TIKTOK_CLIENT_SECRET) {
    return { enabled: false, reason: "credentials_missing" };
  }

  if (!isValidRedirectUri(config.TIKTOK_REDIRECT_URI)) {
    return { enabled: false, reason: "redirect_invalid" };
  }

  if (!getTrustedApplicationOrigin()) {
    return { enabled: false, reason: "trusted_origin_missing" };
  }

  return { enabled: true, reason: "ready" };
}

/** Return credentials only after every safety gate has passed. */
export function getTikTokOAuthConfig(): TikTokOAuthConfig | null {
  const status = getTikTokIntegrationStatus();
  if (!status.enabled) return null;

  const config = getServerConfig();

  return {
    clientKey: config.TIKTOK_CLIENT_KEY!,
    clientSecret: config.TIKTOK_CLIENT_SECRET!,
    redirectUri: config.TIKTOK_REDIRECT_URI!,
  };
}

/** TikTok web redirect URIs must be absolute, static HTTPS URLs. */
export function isValidRedirectUri(value: string | undefined): value is string {
  if (!value || value !== value.trim() || value.length >= 512) return false;

  try {
    const url = new URL(value);
    return (
      url.toString() === value &&
      url.protocol === "https:" &&
      !url.search &&
      !url.hash &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

/**
 * The only origin used for post-OAuth redirects. Never derive this from the
 * request Host header, which may be attacker-controlled behind a proxy.
 */
export function getTrustedApplicationOrigin(): string | null {
  const value = process.env.KOMU_TRUSTED_APP_ORIGIN;
  if (!value || value !== value.trim()) return null;

  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      (process.env.NODE_ENV === "production" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}
