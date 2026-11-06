import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeDatabaseEnvironment } from "@/lib/config/database-environment";

const dotenv = vi.hoisted(() => ({ config: vi.fn(() => { throw Error("Build must not load environment files"); }) }));
vi.mock("dotenv", () => dotenv);
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("generation-only worker build configuration", () => {
  it.each([undefined, 'postgresql://canary:canary@production.invalid/neondb'])('uses only the placeholder, independent of inherited URL', async inherited => {
    vi.stubEnv('DATABASE_URL', inherited);
    vi.stubEnv('KOMU_DATABASE_TARGET', 'neon-test');
    vi.stubEnv('KOMU_NEON_TEST_DATABASE_URL', 'postgresql://canary:canary@test.invalid/neondb');
    vi.resetModules();
    const config = await import('../../deploy/bot/prisma-generate.config');
    const url = new URL(process.env.DATABASE_URL!);
    expect(url.hostname).toBe('127.0.0.1'); expect(url.port).toBe('9'); expect(url.pathname).toBe('/komu_build');
    expect(process.env.DATABASE_URL).not.toContain('canary');
    expect(dotenv.config).not.toHaveBeenCalled();
    expect(resolve(fileURLToPath(new URL('../../deploy/bot/', import.meta.url)), config.default.schema!))
      .toBe(fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url)));
  });
  it('leaves runtime environment validation strict and independent', () => {
    expect(() => initializeDatabaseEnvironment({ NODE_ENV: 'production' })).toThrow('DATABASE_URL is required');
    expect(() => initializeDatabaseEnvironment({ NODE_ENV: 'production', DATABASE_URL: 'not-a-url' })).toThrow('valid PostgreSQL URL');
    expect(() => initializeDatabaseEnvironment({ NODE_ENV: 'production', KOMU_DATABASE_TARGET: 'neon-test' })).toThrow('not allowed in production');
  });
});
