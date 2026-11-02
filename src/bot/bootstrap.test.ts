import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { load, botEntry, registrationEntry } = vi.hoisted(() => ({
  load: vi.fn(),
  botEntry: vi.fn(),
  registrationEntry: vi.fn(),
}));

vi.mock("dotenv", () => ({ config: load }));
// These factories replace the entire entry modules, including all their static
// imports. No Discord client, health server, or Prisma engine can start.
vi.mock("./index", () => {
  botEntry(process.env.DATABASE_URL, process.env.DISCORD_BOT_TOKEN);
  return {};
});
vi.mock("./register-commands", () => {
  registrationEntry(process.env.DATABASE_URL, process.env.DISCORD_BOT_TOKEN);
  return {};
});

const TEST_URL = "postgresql://user:password@ep-test.us-east-2.aws.neon.tech/test";
const originalExitCode = process.exitCode;

describe.each(["bot", "registration"] as const)("%s bootstrap", (entry) => {
  async function bootstrap() {
    if (entry === "bot") await import("./bootstrap");
    else await import("./register-bootstrap");
    await vi.dynamicImportSettled();
  }

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("KOMU_DATABASE_TARGET", "neon-test");
    vi.stubEnv("KOMU_NEON_TEST_DATABASE_URL", TEST_URL);
    vi.stubEnv("DATABASE_URL", "postgresql://stale.example/old");
    vi.stubEnv("DISCORD_BOT_TOKEN", "inherited-token");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    load.mockImplementation(() => {
      process.env.DATABASE_URL ??= "postgresql://file.example/old";
      process.env.DISCORD_BOT_TOKEN ??= "file-token";
      return { parsed: {} };
    });
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("preloads repository env files without override before importing the entry", async () => {
    await bootstrap();
    expect(load).toHaveBeenCalledExactlyOnceWith({
      path: [resolve(__dirname, "../../.env.local"), resolve(__dirname, "../../.env")],
      quiet: true,
    });
    const start = entry === "bot" ? botEntry : registrationEntry;
    expect(start).toHaveBeenCalledExactlyOnceWith(TEST_URL, "inherited-token");
    expect(load.mock.invocationCallOrder[0]).toBeLessThan(start.mock.invocationCallOrder[0]);
  });

  it("fails before importing the entry if the selected URL is missing", async () => {
    vi.stubEnv("KOMU_NEON_TEST_DATABASE_URL", undefined);
    await bootstrap();
    expect(botEntry).not.toHaveBeenCalled();
    expect(registrationEntry).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      entry === "bot" ? "Bot bootstrap failed:" : "Bot registration bootstrap failed:",
      "KOMU_NEON_TEST_DATABASE_URL is required for neon-test.",
    );
  });
});
