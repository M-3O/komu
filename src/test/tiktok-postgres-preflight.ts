const LOCAL_TARGET = "local-disposable";
const DISPOSABLE_DATABASE = "komu_tiktok_disposable";
const SYNTHETIC_AUTH_SECRET = "local-only-tiktok-postgres-test-secret";

export class TikTokPostgresPreflightError extends Error {
  name = "TikTokPostgresPreflightError";
}

function fail(): never {
  // Never include a URL, username, password, host, or driver error in this
  // message. This function runs before Prisma is constructed.
  throw new TikTokPostgresPreflightError(
    "TikTok PostgreSQL tests require an explicitly approved loopback disposable database; no database connection was attempted.",
  );
}

/**
 * Select only the database explicitly supplied for this suite.
 *
 * The normal application URL is deliberately rejected even when it points to
 * localhost. This prevents an inherited shell or dotenv value from silently
 * changing the test target.
 */
export function tiktokPostgresUrl(
  env: Readonly<Record<string, string | undefined>>,
): string {
  if (
    env.KOMU_DATABASE_TARGET !== LOCAL_TARGET ||
    env.KOMU_TIKTOK_DB_APPROVED !== "1" ||
    env.NODE_ENV === "production" ||
    env.DATABASE_URL !== undefined ||
    env.KOMU_NEON_TEST_DATABASE_URL !== undefined ||
    env.KOMU_PRODUCTION_DATABASE_URL !== undefined
  ) {
    return fail();
  }

  const value = env.KOMU_TIKTOK_DATABASE_URL;
  if (!value || value !== value.trim() || /\s|%(?![\da-f]{2})/i.test(value)) {
    return fail();
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail();
  }

  const host = url.hostname.toLowerCase();
  let database: string;
  try {
    database = decodeURIComponent(url.pathname.slice(1));
  } catch {
    return fail();
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(host) ||
    database !== DISPOSABLE_DATABASE ||
    url.hash ||
    url.username === "" ||
    url.searchParams.getAll("schema").some((schema) => schema !== "public") ||
    url.searchParams.getAll("sslmode").some((sslmode) => sslmode !== "disable")
  ) {
    return fail();
  }

  const allowedParameters = new Set([
    "schema",
    "sslmode",
    "connection_limit",
    "pool_timeout",
    "connect_timeout",
  ]);
  for (const key of url.searchParams.keys()) {
    if (!allowedParameters.has(key) || url.searchParams.getAll(key).length !== 1) {
      return fail();
    }
  }

  // The suite overwrites these with synthetic values before importing Prisma
  // consumers. An inherited real secret must never be used in local tests.
  if (
    env.AUTH_SECRET !== undefined &&
    env.AUTH_SECRET !== SYNTHETIC_AUTH_SECRET
  ) {
    return fail();
  }

  return value;
}

export const TIKTOK_POSTGRES_SYNTHETIC_AUTH_SECRET = SYNTHETIC_AUTH_SECRET;
