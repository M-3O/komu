import { describe, expect, it } from "vitest";

import {
  TIKTOK_POSTGRES_SYNTHETIC_AUTH_SECRET,
  TikTokPostgresPreflightError,
  tiktokPostgresUrl,
} from "./tiktok-postgres-preflight";

const validUrl =
  "postgresql://fixture@127.0.0.1:5432/komu_tiktok_disposable?schema=public&sslmode=disable";

const validEnvironment = () => ({
  KOMU_DATABASE_TARGET: "local-disposable",
  KOMU_TIKTOK_DB_APPROVED: "1",
  KOMU_TIKTOK_DATABASE_URL: validUrl,
  NODE_ENV: "test",
});

describe("TikTok disposable PostgreSQL preflight", () => {
  it("accepts only the explicit loopback target without mutating input", () => {
    const environment = validEnvironment();
    expect(tiktokPostgresUrl(environment)).toBe(validUrl);
    expect(environment).toEqual(validEnvironment());
  });

  it.each([
    {},
    { ...validEnvironment(), KOMU_TIKTOK_DB_APPROVED: "0" },
    { ...validEnvironment(), KOMU_DATABASE_TARGET: "default" },
    { ...validEnvironment(), DATABASE_URL: validUrl },
    { ...validEnvironment(), KOMU_NEON_TEST_DATABASE_URL: validUrl },
    { ...validEnvironment(), KOMU_PRODUCTION_DATABASE_URL: validUrl },
    { ...validEnvironment(), NODE_ENV: "production" },
    { ...validEnvironment(), KOMU_TIKTOK_DATABASE_URL: validUrl.replace("127.0.0.1", "db.example") },
    { ...validEnvironment(), KOMU_TIKTOK_DATABASE_URL: validUrl.replace("komu_tiktok_disposable", "komu") },
    { ...validEnvironment(), KOMU_TIKTOK_DATABASE_URL: validUrl.replace("sslmode=disable", "sslmode=require") },
    { ...validEnvironment(), AUTH_SECRET: "a-real-looking-inherited-secret" },
  ])("fails closed for unsafe configuration (case %#)", (environment) => {
    expect(() => tiktokPostgresUrl(environment)).toThrow(
      TikTokPostgresPreflightError,
    );
  });

  it("does not expose the URL or a secret in its failure", () => {
    try {
      tiktokPostgresUrl({
        ...validEnvironment(),
        DATABASE_URL: "postgresql://private-marker",
      });
      expect.fail("Expected preflight rejection");
    } catch (error) {
      expect(String(error)).not.toContain("private-marker");
      expect(String(error)).not.toContain(validUrl);
      expect(String(error)).not.toContain(TIKTOK_POSTGRES_SYNTHETIC_AUTH_SECRET);
    }
  });
});
