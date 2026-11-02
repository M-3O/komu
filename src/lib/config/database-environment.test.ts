import { describe, expect, it } from "vitest";

import {
  initializeDatabaseEnvironment,
  databaseDiagnostic,
  validateDatabaseUrl,
} from "./database-environment";

const VALID_URL = "postgresql://user:password@ep-example-pooler.us-east-2.aws.neon.tech/database?schema=public";

describe("database environment", () => {
  it("accepts PostgreSQL URL schemes without printing or inspecting credentials", () => {
    expect(() => validateDatabaseUrl(VALID_URL)).not.toThrow();
    expect(() =>
      validateDatabaseUrl("postgres://user:password@test/db"),
    ).not.toThrow();
  });

  it("rejects missing and malformed database URLs", () => {
    expect(() => validateDatabaseUrl(undefined)).toThrow(
      "DATABASE_URL is required.",
    );
    expect(() => validateDatabaseUrl("not-a-database-url")).toThrow(
      "DATABASE_URL must be a valid PostgreSQL URL.",
    );
  });

  it("selects the explicit Neon test URL instead of falling back", () => {
    const environment = {
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://stale.example/old",
      KOMU_DATABASE_TARGET: "neon-test",
      KOMU_NEON_TEST_DATABASE_URL: VALID_URL,
    };

    initializeDatabaseEnvironment(environment);

    expect(environment.DATABASE_URL).toBe(VALID_URL);
  });

  it("requires a valid test URL when the Neon test target is selected", () => {
    expect(() =>
      initializeDatabaseEnvironment({
        NODE_ENV: "development",
        DATABASE_URL: VALID_URL,
        KOMU_DATABASE_TARGET: "neon-test",
      }),
    ).toThrow("KOMU_NEON_TEST_DATABASE_URL is required for neon-test.");
  });

  it("rejects the development test target in production", () => {
    expect(() =>
      initializeDatabaseEnvironment({
        NODE_ENV: "production",
        KOMU_DATABASE_TARGET: "neon-test",
        KOMU_NEON_TEST_DATABASE_URL: VALID_URL,
      }),
    ).toThrow("is not allowed in production.");
  });

  it.each([
    "https://example.com/database",
    "postgresql://host",
    "postgresql://host/database#fragment",
    "postgresql://host/data base",
    "postgresql://host/database?password=%oops",
    "postgresql://user:pass@host:invalid/database",
    " postgres://host/database",
    "postgresql://user:password@unsafe%0ahost/database",
  ])("rejects malformed URLs without echoing the input", (url) => {
    expect(() => validateDatabaseUrl(url)).toThrow(
      "DATABASE_URL must be a valid PostgreSQL URL.",
    );
  });

  it("preserves the default production URL when no test selection is requested", () => {
    const environment = { NODE_ENV: "production", DATABASE_URL: VALID_URL };
    const selected = initializeDatabaseEnvironment(environment);
    expect(selected.target).toBe("default");
    expect(selected.url).toBe(VALID_URL);
    expect(environment.DATABASE_URL).toBe(VALID_URL);
  });

  it("fails if a test URL is present but the target was omitted", () => {
    expect(() => initializeDatabaseEnvironment({
      DATABASE_URL: VALID_URL,
      KOMU_NEON_TEST_DATABASE_URL: VALID_URL,
    })).toThrow("refusing to fall back");
  });

  it("rejects an unknown target and non-Neon test endpoints", () => {
    expect(() => initializeDatabaseEnvironment({
      DATABASE_URL: VALID_URL,
      KOMU_DATABASE_TARGET: "typo",
    })).toThrow("must be unset or set to neon-test");
    expect(() => initializeDatabaseEnvironment({
      KOMU_DATABASE_TARGET: "neon-test",
      KOMU_NEON_TEST_DATABASE_URL: "postgresql://host/database",
    })).toThrow("must use a Neon endpoint");
  });

  it("refuses a malformed selected URL rather than using a valid fallback", () => {
    expect(() => initializeDatabaseEnvironment({
      DATABASE_URL: VALID_URL,
      KOMU_DATABASE_TARGET: "neon-test",
      KOMU_NEON_TEST_DATABASE_URL: "malformed-secret-input",
    })).toThrow("DATABASE_URL must be a valid PostgreSQL URL.");
  });

  it.each(["DATABASE_URL", "KOMU_DATABASE_TARGET", "KOMU_NEON_TEST_DATABASE_URL"])(
    "detects changes to %s after initial selection", (key) => {
      const environment: Record<string, string | undefined> = {
        KOMU_DATABASE_TARGET: "neon-test",
        KOMU_NEON_TEST_DATABASE_URL: VALID_URL,
      };
      const selected = initializeDatabaseEnvironment(environment);
      expect(initializeDatabaseEnvironment(environment)).toBe(selected);
      environment[key] = "unexpected-override";
      expect(() => initializeDatabaseEnvironment(environment)).toThrow(
        "Database configuration changed after initialization.",
      );
    },
  );

  it("logs only the target and sanitized hostname", () => {
    const selected = initializeDatabaseEnvironment({
      KOMU_DATABASE_TARGET: "neon-test",
      KOMU_NEON_TEST_DATABASE_URL: VALID_URL,
    });
    expect(databaseDiagnostic(selected)).toBe(
      "[database] target=neon-test hostname=ep-example-pooler.us-east-2.aws.neon.tech",
    );
  });
});
