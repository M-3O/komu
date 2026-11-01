import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { construct } = vi.hoisted(() => ({
  construct: vi.fn(function () { return {}; }),
}));

// No real Prisma engine, database connection, or query is used by these tests.
vi.mock("@prisma/client", () => ({ PrismaClient: construct }));

const TEST_URL = "postgresql://user:password@ep-test.us-east-2.aws.neon.tech/test";
const STALE_URL = "postgresql://stale:secret@ep-old.us-east-2.aws.neon.tech/old";
const cache = globalThis as unknown as {
  prisma?: unknown;
  prismaDatabaseConfiguration?: unknown;
};

describe("runtime Prisma database selection", () => {
  beforeEach(() => {
    vi.resetModules();
    construct.mockClear();
    delete cache.prisma;
    delete cache.prismaDatabaseConfiguration;
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", STALE_URL);
    vi.stubEnv("KOMU_DATABASE_TARGET", "neon-test");
    vi.stubEnv("KOMU_NEON_TEST_DATABASE_URL", TEST_URL);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete cache.prisma;
    delete cache.prismaDatabaseConfiguration;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("pins the selected test URL in Prisma even without the bot bootstrap", async () => {
    await import("./db");
    expect(construct).toHaveBeenCalledExactlyOnceWith({
      datasourceUrl: TEST_URL,
      log: ["warn", "error"],
    });
    expect(console.info).toHaveBeenCalledExactlyOnceWith(
      "[database] target=neon-test hostname=ep-test.us-east-2.aws.neon.tech",
    );
  });

  it("fails before constructing Prisma when the test URL is missing", async () => {
    vi.stubEnv("KOMU_NEON_TEST_DATABASE_URL", undefined);
    await expect(import("./db")).rejects.toThrow("KOMU_NEON_TEST_DATABASE_URL is required");
    expect(construct).not.toHaveBeenCalled();
  });

  it("rejects an override between bootstrap selection and Prisma initialization", async () => {
    const { initializeDatabaseEnvironment } = await import("./config/database-environment");
    initializeDatabaseEnvironment();
    process.env.DATABASE_URL = STALE_URL;
    await expect(import("./db")).rejects.toThrow("changed after initialization");
    expect(construct).not.toHaveBeenCalled();
  });

  it("reuses a cached client only with the same selection", async () => {
    const first = await import("./db");
    vi.resetModules();
    const second = await import("./db");
    expect(first.prisma).toBe(second.prisma);
    expect(construct).toHaveBeenCalledTimes(1);
    expect(console.info).toHaveBeenCalledTimes(1);
  });

  it("rejects a cached client after the selected URL changes", async () => {
    await import("./db");
    vi.resetModules();
    process.env.KOMU_NEON_TEST_DATABASE_URL = STALE_URL;
    await expect(import("./db")).rejects.toThrow("Cached Prisma client does not match");
    expect(construct).toHaveBeenCalledTimes(1);
  });

  it("rejects a legacy cached client with unknown database identity", async () => {
    cache.prisma = {};
    await expect(import("./db")).rejects.toThrow("Cached Prisma client does not match");
    expect(construct).not.toHaveBeenCalled();
  });
});
