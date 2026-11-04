/** Fixed monitoring vocabulary. Never serialize exceptions, causes, messages or URLs. */
export const ERROR_CODES = [
  "DISCORD_AUTH_FAILED", "DISCORD_PERMISSION_DENIED", "DISCORD_RESOURCE_UNAVAILABLE",
  "DISCORD_RATE_LIMITED", "DISCORD_TIMEOUT", "DISCORD_NETWORK", "DISCORD_REQUEST_FAILED",
  "DATABASE_AUTH_FAILED", "DATABASE_UNREACHABLE", "DATABASE_POOL_TIMEOUT",
  "DATABASE_TLS_FAILED", "DATABASE_TRANSACTION_FAILED", "DATABASE_REQUEST_FAILED",
  "PROVIDER_NOT_CONFIGURED", "PROVIDER_AUTH_FAILED", "PROVIDER_PERMISSION_DENIED",
  "PROVIDER_QUOTA_OR_DISABLED", "PROVIDER_RATE_LIMITED", "PROVIDER_TIMEOUT",
  "PROVIDER_NETWORK", "PROVIDER_REQUEST_FAILED", "JOB_FAILED", "JOB_PARTIAL",
  "STREAM_DELIVERY_FAILED", "STREAM_DELIVERY_RECORD_FAILED", "STREAM_CONFIGURATION_INVALID",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export type ErrorDomain = "discord" | "postgres" | "provider" | "job";
const codes: ReadonlySet<unknown> = new Set(ERROR_CODES);
export function isErrorCode(value: unknown): value is ErrorCode { return codes.has(value); }

/** Getters/proxies can throw; monitoring must still return only a fixed code. */
export function classifyError(error: unknown, domain: ErrorDomain): ErrorCode {
  const fallback = domain === "discord" ? "DISCORD_REQUEST_FAILED"
    : domain === "postgres" ? "DATABASE_REQUEST_FAILED"
    : domain === "provider" ? "PROVIDER_REQUEST_FAILED" : "JOB_FAILED";
  try {
    const value = error as { code?: unknown; status?: unknown; name?: unknown } | null;
    const code = value?.code;
    const status = value?.status;
    const name = value?.name;
    if (isErrorCode(code)) return code;
    // PostgreSQL failures remain distinguishable when a job surfaces them.
    if (code === "P1000" || code === "P1010") return "DATABASE_AUTH_FAILED";
    if (code === "P1001" || code === "P1002" || code === "P1017") return "DATABASE_UNREACHABLE";
    if (code === "P2024") return "DATABASE_POOL_TIMEOUT";
    if (code === "P1011") return "DATABASE_TLS_FAILED";
    if (code === "P2028" || code === "P2034" || code === "40P01" || code === "40001") return "DATABASE_TRANSACTION_FAILED";
    if (domain === "postgres") return fallback;
    if (domain === "discord") {
      if (status === 401 || code === "HTTP_401") return "DISCORD_AUTH_FAILED";
      if (status === 403 || code === 50013 || code === 50001 || code === "DISCORD_50013" || code === "DISCORD_50001") return "DISCORD_PERMISSION_DENIED";
      if (status === 404 || code === 10003) return "DISCORD_RESOURCE_UNAVAILABLE";
      if (status === 429 || code === "HTTP_429") return "DISCORD_RATE_LIMITED";
      if (name === "TimeoutError" || name === "AbortError" || code === "TIMEOUT") return "DISCORD_TIMEOUT";
      if (code === "NETWORK" || name === "TypeError") return "DISCORD_NETWORK";
    }
    if (domain === "provider") {
      if (code === "NOT_CONFIGURED") return "PROVIDER_NOT_CONFIGURED";
      if (status === 401 || code === "TOKEN_FAILED") return "PROVIDER_AUTH_FAILED";
      if (code === "QUOTA_OR_API_DISABLED") return "PROVIDER_QUOTA_OR_DISABLED";
      if (status === 403) return "PROVIDER_PERMISSION_DENIED";
      if (status === 429 || code === "RATE_LIMITED") return "PROVIDER_RATE_LIMITED";
      if (name === "TimeoutError" || name === "AbortError" || code === "TIMEOUT") return "PROVIDER_TIMEOUT";
      if (code === "NETWORK") return "PROVIDER_NETWORK";
    }
  } catch { /* No exception data escapes this boundary. */ }
  return fallback;
}
