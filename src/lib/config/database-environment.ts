/**
 * Validate and select the database used by a local or server process.
 *
 * Next.js loads environment files before next.config.ts is evaluated. The
 * standalone bot and Prisma CLI load the same local files explicitly before
 * calling this module. Keeping the selection here means all three entry
 * points apply the same rules without ever logging the connection string.
 */

const TEST_DATABASE_TARGET = "neon-test";
const DATABASE_TARGET_ENV = "KOMU_DATABASE_TARGET";
const TEST_DATABASE_URL_ENV = "KOMU_NEON_TEST_DATABASE_URL";
const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);

export type DatabaseEnvironment = Record<string, string | undefined>;

export type DatabaseConfiguration = Readonly<{
  target: "default" | "neon-test";
  url: string;
  hostname: string;
}>;

/** Messages from this error contain fixed instructions, never input values. */
export class DatabaseEnvironmentError extends Error {
  name = "DatabaseEnvironmentError";
}

const selections = new WeakMap<DatabaseEnvironment, DatabaseConfiguration>();

export function validateDatabaseUrl(value: string | undefined): void {
  if (!value || value.trim().length === 0) {
    throw new DatabaseEnvironmentError("DATABASE_URL is required.");
  }

  try {
    const parsed = new URL(value);

    if (
      !POSTGRES_PROTOCOLS.has(parsed.protocol) ||
      !parsed.hostname ||
      !/^(?:[a-z0-9._-]+|\[[a-f0-9:]+\])$/i.test(parsed.hostname) ||
      !parsed.pathname.slice(1) ||
      parsed.hash ||
      /\s|%(?![\da-f]{2})/i.test(value)
    ) {
      throw new Error("unsupported PostgreSQL URL");
    }
  } catch {
    throw new DatabaseEnvironmentError("DATABASE_URL must be a valid PostgreSQL URL.");
  }
}

export function initializeDatabaseEnvironment(
  environment: DatabaseEnvironment = process.env,
): DatabaseConfiguration {
  const target = environment[DATABASE_TARGET_ENV]?.trim().toLowerCase();
  const previous = selections.get(environment);

  if (previous) {
    if (
      environment.DATABASE_URL !== previous.url ||
      (target || "default") !== previous.target ||
      (previous.target === "default" &&
        environment[TEST_DATABASE_URL_ENV] !== undefined) ||
      (previous.target === TEST_DATABASE_TARGET &&
        (environment[TEST_DATABASE_URL_ENV] !== previous.url ||
          environment.NODE_ENV === "production"))
    ) {
      throw new DatabaseEnvironmentError(
        "Database configuration changed after initialization. Restart the process with the intended database environment.",
      );
    }
    return previous;
  }

  if (!target) {
    if (environment[TEST_DATABASE_URL_ENV] !== undefined) {
      throw new DatabaseEnvironmentError(
        "KOMU_NEON_TEST_DATABASE_URL requires KOMU_DATABASE_TARGET=neon-test; refusing to fall back to DATABASE_URL.",
      );
    }
    validateDatabaseUrl(environment.DATABASE_URL);
  } else if (target !== TEST_DATABASE_TARGET) {
    throw new DatabaseEnvironmentError(
      DATABASE_TARGET_ENV +
        " must be unset or set to " +
        TEST_DATABASE_TARGET +
        ".",
    );
  } else if (environment.NODE_ENV === "production") {
    throw new DatabaseEnvironmentError(
      DATABASE_TARGET_ENV +
        "=" +
        TEST_DATABASE_TARGET +
        " is not allowed in production.",
    );
  } else {
    const testDatabaseUrl = environment[TEST_DATABASE_URL_ENV];
    if (!testDatabaseUrl) {
      throw new DatabaseEnvironmentError("KOMU_NEON_TEST_DATABASE_URL is required for neon-test.");
    }
    validateDatabaseUrl(testDatabaseUrl);
    if (!new URL(testDatabaseUrl).hostname.toLowerCase().endsWith(".neon.tech")) {
      throw new DatabaseEnvironmentError("KOMU_NEON_TEST_DATABASE_URL must use a Neon endpoint.");
    }

    // Explicit test selection intentionally replaces a stale inherited URL.
    // All subsequent calls must match this first selection exactly.
    environment.DATABASE_URL = testDatabaseUrl;
  }

  const url = environment.DATABASE_URL!;
  const hostname = new URL(url).hostname;
  const selected = Object.freeze({
    target: target === TEST_DATABASE_TARGET ? TEST_DATABASE_TARGET : "default",
    url,
    hostname: /^(?:[a-z0-9.:-]+|\[[a-f0-9:]+\])$/i.test(hostname)
      ? hostname
      : "[redacted-host]",
  } as const);
  selections.set(environment, selected);
  return selected;
}

/** Never pass a configuration object to a logger: it contains the raw URL. */
export function databaseDiagnostic(configuration: DatabaseConfiguration): string {
  return `[database] target=${configuration.target} hostname=${configuration.hostname}`;
}
