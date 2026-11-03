import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { databaseFailureKind } from "./payout-postgres-preflight";
import { productionDiagnosticUrl } from "./production-neon-target";

export interface CliStatusReport {
  exitCode: number | null;
  state: "up-to-date" | "pending-review" | "history-error" | "engine-error" | "unrecognized" | "launch-failed" | "timeout";
  reason: string;
  expectedMigrationMentioned: boolean;
  migrationApproved: false;
}

/** Known output markers are hints only; never print raw CLI output or approve DDL. */
export function summarizePrismaStatus(output: string, exitCode: number | null): CliStatusReport {
  const code = output.match(/\b(P1000|P1001|P1002|P1003|P1008|P1010|P1011|P1017|P2024|P2028)\b/)?.[1];
  const historyError = /\bP30(?:09|18)\b|failed migration|migration histories? .*diverg|following migrations? have been modified/i.test(output);
  const state = code ? "engine-error" : historyError ? "history-error" :
    exitCode === 0 && /database schema is up to date/i.test(output) ? "up-to-date" :
    exitCode === 1 && /following migration[\s\S]*not yet been applied/i.test(output) ? "pending-review" : "unrecognized";
  return {
    exitCode, state, reason: code ? databaseFailureKind({ code }) : "REVIEW_STATUS_STATE",
    expectedMigrationMentioned: output.includes("20261029120000_challenge_completion_announcements"),
    migrationApproved: false,
  };
}

/** Operator-only read-only status, with the exact same validated URI as the client. */
export async function diagnoseProductionPrismaStatus(
  env: Readonly<Record<string, string | undefined>>,
): Promise<CliStatusReport> {
  const url = productionDiagnosticUrl(env); // Reject before spawning anything.
  const childEnv: NodeJS.ProcessEnv = { ...env, NODE_ENV: "production", DATABASE_URL: url };
  for (const key of ["KOMU_DATABASE_TARGET", "KOMU_NEON_TEST_DATABASE_URL", "KOMU_PRODUCTION_DIAGNOSTIC_DATABASE_URL",
    "DEBUG", "RUST_LOG", "PRISMA_LOG_LEVEL"]) delete childEnv[key];
  return new Promise((complete) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (report: CliStatusReport) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      complete(report);
    };
    const failed = (state: "launch-failed" | "timeout"): CliStatusReport => ({
      exitCode: null, state, reason: state === "timeout" ? "CLI_DEADLINE_EXCEEDED" : "CLI_LAUNCH_FAILED",
      expectedMigrationMentioned: false, migrationApproved: false,
    });
    try {
      const child = spawn(process.execPath, [
        resolve(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "status",
      ], { cwd: process.cwd(), env: childEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      const collect = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-262_144); };
      child.stdout?.on("data", collect);
      child.stderr?.on("data", collect);
      child.once("error", () => finish(failed("launch-failed")));
      child.once("close", (code) => finish(summarizePrismaStatus(output, code)));
      timer = setTimeout(() => {
        finish(failed("timeout"));
        try { child.kill(); } catch { /* Keep the deadline result sanitized. */ }
      }, 40_000);
    } catch { finish(failed("launch-failed")); }
  });
}
