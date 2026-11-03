import { PayoutPreflightError } from "./payout-postgres-preflight";

export const PRODUCTION_NEON_HOST = "ep-misty-hat-b5hmnp08.c-7.us-east-2.aws.neon.tech";

/** Explicit operator input only: never use DATABASE_URL or dotenv as a fallback. */
export function productionDiagnosticUrl(env: Readonly<Record<string, string | undefined>>): string {
  const reject = (): never => {
    throw new PayoutPreflightError("INVALID_TARGET_CONFIGURATION", "configuration",
      "Production diagnostics require production mode, the independently confirmed production host, and a dedicated valid TLS URL.");
  };
  if (env.NODE_ENV !== "production" || env.KOMU_EXPECTED_PRODUCTION_HOST !== PRODUCTION_NEON_HOST ||
      env.KOMU_DATABASE_TARGET !== undefined || env.KOMU_NEON_TEST_DATABASE_URL !== undefined) reject();
  const original = env.KOMU_PRODUCTION_DIAGNOSTIC_DATABASE_URL;
  if (!original || /\s|%(?![\da-f]{2})/i.test(original)) return reject();
  let url: URL;
  try { url = new URL(original); } catch { return reject(); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      url.hostname !== PRODUCTION_NEON_HOST || url.pathname !== "/neondb" ||
      !["", "5432"].includes(url.port) || url.hash || !url.username || !url.password ||
      (url.searchParams.get("schema") ?? "public") !== "public" ||
      url.searchParams.get("sslmode") !== "require") reject();
  const allowed = new Set(["schema", "sslmode", "sslaccept", "connect_timeout", "pool_timeout", "connection_limit", "channel_binding"]);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) reject();
  }
  if (url.searchParams.has("sslaccept") && url.searchParams.get("sslaccept") !== "strict") reject();
  if (url.searchParams.has("channel_binding") &&
      !["require", "prefer", "disable"].includes(url.searchParams.get("channel_binding")!)) reject();
  for (const key of ["connect_timeout", "pool_timeout", "connection_limit"]) {
    const value = url.searchParams.get(key);
    if (value !== null && (!/^[1-9]\d*$/.test(value) || Number(value) > 300)) reject();
  }
  // Append only a fixed certificate-verification option. Never serialize,
  // decode/re-encode userinfo, repair passwords, or rebuild a caller's query.
  return url.searchParams.has("sslaccept") ? original! : original + "&sslaccept=strict";
}
