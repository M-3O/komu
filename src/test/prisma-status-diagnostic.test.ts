import { EventEmitter } from "node:events";

import { afterEach, expect, it, vi } from "vitest";

const processMock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: processMock.spawn }));

import { diagnoseProductionPrismaStatus, summarizePrismaStatus } from "./prisma-status-diagnostic";
import { PRODUCTION_NEON_HOST } from "./production-neon-target";

const original = `postgresql://fixture:secret%40value@${PRODUCTION_NEON_HOST}/neondb?sslmode=require&connect_timeout=20`;
const env = () => ({
  NODE_ENV: "production", KOMU_EXPECTED_PRODUCTION_HOST: PRODUCTION_NEON_HOST,
  KOMU_PRODUCTION_DIAGNOSTIC_DATABASE_URL: original,
  DATABASE_URL: "postgresql://unrelated.invalid/ignored",
});
function child() {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(),
  });
}
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

it("spawns only migrate status with the validated unchanged production userinfo and no dotenv override", async () => {
  const subprocess = child();
  processMock.spawn.mockReturnValueOnce(subprocess);
  const input = env();
  const pending = diagnoseProductionPrismaStatus(input);
  const [executable, args, options] = processMock.spawn.mock.calls[0];
  expect(executable).toBe(process.execPath);
  expect(args.slice(1)).toEqual(["migrate", "status"]);
  expect(options.env.DATABASE_URL).toBe(original + "&sslaccept=strict");
  expect(options.env.NODE_ENV).toBe("production");
  expect(options.env.KOMU_DATABASE_TARGET).toBeUndefined();
  expect(options.env.KOMU_NEON_TEST_DATABASE_URL).toBeUndefined();
  expect(options.stdio).toEqual(["ignore", "pipe", "pipe"]);
  subprocess.stderr.emit("data", Buffer.from("P1001 secret%40value " + original));
  subprocess.emit("close", 1);
  const report = await pending;
  expect(report).toMatchObject({ state: "engine-error", reason: "UNREACHABLE", migrationApproved: false });
  expect(JSON.stringify(report)).not.toMatch(/secret|postgresql|fixture/);
  expect(input).toEqual(env());
});

it("rejects bad identity before spawning the CLI", async () => {
  await expect(diagnoseProductionPrismaStatus({ ...env(), KOMU_EXPECTED_PRODUCTION_HOST: "other.neon.tech" }))
    .rejects.toThrow("INVALID_TARGET_CONFIGURATION");
  expect(processMock.spawn).not.toHaveBeenCalled();
});

it("bounds a stalled CLI and never retries it", async () => {
  vi.useFakeTimers();
  const subprocess = child();
  processMock.spawn.mockReturnValueOnce(subprocess);
  const pending = diagnoseProductionPrismaStatus(env());
  await vi.advanceTimersByTimeAsync(40_001);
  expect(await pending).toMatchObject({ state: "timeout", migrationApproved: false });
  expect(subprocess.kill).toHaveBeenCalledTimes(1);
  expect(processMock.spawn).toHaveBeenCalledTimes(1);
});

it.each([
  ["Database schema is up to date!", 0, "up-to-date"],
  ["Following migration(s) have not yet been applied:\n20261029120000_challenge_completion_announcements", 1, "pending-review"],
  ["P3009 failed migrations found secret-raw-log", 1, "history-error"],
  ["P1011 secret-raw-log", 1, "engine-error"],
  ["unrecognized secret-raw-log", 1, "unrecognized"],
])("summarizes status without exposing its raw output (case %#)", (text, code, state) => {
  const report = summarizePrismaStatus(text, code);
  expect(report.state).toBe(state);
  expect(report.migrationApproved).toBe(false);
  expect(JSON.stringify(report)).not.toContain("secret-raw-log");
});
