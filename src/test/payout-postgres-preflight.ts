import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { PrismaClient } from "@prisma/client";

export const PAYOUT_TEST_HOST = "ep-purple-king-b5ojr6aq.c-7.us-east-2.aws.neon.tech";

type PreflightStage = "configuration" | "local migration manifest" | "transaction start" |
  "read-only guard" | "database identity" | "migration history" | "required columns" |
  "required indexes" | "transaction commit";

export type PayoutPreflightCode =
  | "INVALID_TARGET_CONFIGURATION" | "ENDPOINT_IDENTITY_MISMATCH"
  | "DATABASE_CONNECTIVITY_FAILURE" | "DATABASE_PERMISSION_DENIED"
  | "DATABASE_TRANSACTION_FAILURE" | "DATABASE_IDENTITY_MISMATCH"
  | "READ_ONLY_CHECK_FAILED" | "LOCAL_MIGRATION_MANIFEST_FAILURE"
  | "MIGRATION_HISTORY_MISSING" | "MIGRATION_HISTORY_UNEXPECTED"
  | "MIGRATION_MISSING" | "MIGRATION_INCOMPLETE" | "MIGRATION_EXECUTION_UNVERIFIED"
  | "MIGRATION_CHECKSUM_MISMATCH" | "REQUIRED_COLUMN_MISSING"
  | "REQUIRED_COLUMN_MISMATCH" | "REQUIRED_INDEX_MISSING_OR_INVALID"
  | "METADATA_QUERY_FAILURE";

/** Only fixed messages and locally known object names; never retain a driver error. */
export class PayoutPreflightError extends Error {
  constructor(
    readonly code: PayoutPreflightCode,
    readonly stage: PreflightStage,
    detail: string,
  ) {
    super(`Payout preflight [${code}] (${stage}): ${detail} No fixture writes authorized.`);
    this.name = "PayoutPreflightError";
  }
}

function reject(code: PayoutPreflightCode, stage: PreflightStage, detail: string): never {
  throw new PayoutPreflightError(code, stage, detail);
}

function safeLocalName(name: string): string {
  return /^[a-zA-Z0-9_]{1,120}$/.test(name) ? name : "(local object)";
}

/** A closed set of reasons; no raw codes or messages escape into diagnostics. */
export function databaseFailureKind(error: unknown): string {
  const record = error && typeof error === "object" ? error as {
    code?: unknown; errorCode?: unknown; meta?: { code?: unknown };
  } : {};
  const code = record.code ?? record.errorCode;
  const sqlstate = record.meta?.code ?? code;
  if (code === "P1000" || sqlstate === "28P01" || sqlstate === "28000") return "AUTHENTICATION_FAILED";
  if (code === "P1011") return "TLS_FAILED";
  if (code === "P1001") return "UNREACHABLE";
  if (code === "P1002") return "CONNECTION_TIMEOUT";
  if (code === "P1003") return "DATABASE_UNAVAILABLE";
  if (code === "P1008") return "OPERATION_TIMEOUT";
  if (code === "P1017") return "CONNECTION_CLOSED";
  if (code === "P2024") return "POOL_ACQUISITION_TIMEOUT";
  if (code === "P1010" || sqlstate === "42501") return "ACCESS_DENIED";
  if (typeof sqlstate === "string" && /^08[0-9A-Z]{3}$/.test(sqlstate)) return "CONNECTION_LOST";
  if (["57P01", "57P02", "57P03"].includes(String(sqlstate))) return "SERVER_UNAVAILABLE";
  if (code === "P2028" || ["40001", "40P01", "57014"].includes(String(sqlstate))) return "TRANSACTION_FAILURE";
  return "UNKNOWN";
}

/** Classify only structured, recognized codes, never error.message or meta.message. */
function driverFailure(error: unknown, stage: PreflightStage): PayoutPreflightError {
  const record = error && typeof error === "object" ? error as {
    code?: unknown; errorCode?: unknown; meta?: { code?: unknown };
  } : {};
  const code = record.code ?? record.errorCode;
  const sqlstate = record.meta?.code ?? code;
  if (code === "P1010" || sqlstate === "42501") {
    return new PayoutPreflightError("DATABASE_PERMISSION_DENIED", stage, "Database access or metadata permission was denied.");
  }
  if (databaseFailureKind(error) === "AUTHENTICATION_FAILED" ||
      ["P1000", "P1001", "P1002", "P1003", "P1008", "P1011", "P1017", "P2024"].includes(String(code)) ||
      (typeof sqlstate === "string" && /^08[0-9A-Z]{3}$/.test(sqlstate)) ||
      ["57P01", "57P02", "57P03"].includes(String(sqlstate))) {
    return new PayoutPreflightError("DATABASE_CONNECTIVITY_FAILURE", stage,
      `Connection, authentication, TLS, or connection acquisition failed (${databaseFailureKind(error)}).`);
  }
  if (code === "P2028" || ["40001", "40P01", "57014"].includes(String(sqlstate))) {
    return new PayoutPreflightError("DATABASE_TRANSACTION_FAILURE", stage, "The read-only transaction failed or exceeded its limit.");
  }
  if (stage === "migration history" && sqlstate === "42P01") {
    return new PayoutPreflightError("MIGRATION_HISTORY_MISSING", stage, "public._prisma_migrations could not be found.");
  }
  return new PayoutPreflightError("METADATA_QUERY_FAILURE", stage, "The metadata check could not be completed; raw driver details are suppressed.");
}

/** No dotenv and no DATABASE_URL fallback. Validate before constructing a client. */
export function payoutTestUrl(env: Readonly<Record<string, string | undefined>>): string {
  const fail = () => reject("INVALID_TARGET_CONFIGURATION", "configuration",
    "Explicit neon-test mode and a valid dedicated test URL with TLS and at least two connections are required.");
  if (env.KOMU_DATABASE_TARGET !== "neon-test" || env.NODE_ENV === "production") fail();
  const value = env.KOMU_NEON_TEST_DATABASE_URL;
  if (!value || /\s|%(?![\da-f]{2})/i.test(value)) return fail();
  let url: URL;
  try { url = new URL(value); } catch { return fail(); }
  if (url.hostname !== PAYOUT_TEST_HOST || url.pathname !== "/neondb" ||
      (url.port !== "" && url.port !== "5432") ||
      (url.searchParams.get("schema") ?? "public") !== "public") {
    reject("ENDPOINT_IDENTITY_MISMATCH", "configuration", "The URL must select the approved direct test endpoint, neondb, and public.");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== PAYOUT_TEST_HOST ||
    (url.port !== "" && url.port !== "5432") ||
    url.pathname !== "/neondb" || url.hash ||
    !url.username || !url.password
  ) fail();
  // An allowlist also rejects alternate host/service/options overrides.
  const allowed = new Set(["schema", "sslmode", "sslaccept", "channel_binding", "connection_limit", "pool_timeout", "connect_timeout"]);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) fail();
  }
  // Native Prisma 6 does not implement verify-full: it falls back to prefer.
  if (url.searchParams.get("sslmode") !== "require" ||
      (url.searchParams.has("sslaccept") && url.searchParams.get("sslaccept") !== "strict")) fail();
  for (const key of ["connection_limit", "pool_timeout", "connect_timeout"]) {
    const setting = url.searchParams.get(key);
    if (setting !== null && !/^[1-9]\d*$/.test(setting)) fail();
  }
  if (Number(url.searchParams.get("connection_limit") ?? "2") < 2) fail();
  if (env.DATABASE_URL && env.DATABASE_URL !== value) {
    reject("INVALID_TARGET_CONFIGURATION", "configuration", "A conflicting inherited DATABASE_URL must be cleared in the test shell.");
  }
  return value!;
}

export function migrationScriptChecksums(script: string): { checksum: string; lineEndingChecksums: string[] } {
  const hash = (text: string) => createHash("sha256").update(text).digest("hex");
  const lf = script.replace(/\r\n/g, "\n");
  return { checksum: hash(script), lineEndingChecksums: [...new Set([hash(lf), hash(lf.replace(/\n/g, "\r\n"))])] };
}

type MigrationManifest = Array<{ name: string; checksum: string; lineEndingChecksums?: string[] }>;

export function payoutMigrationManifest(): MigrationManifest {
  const directory = fileURLToPath(new URL("../../prisma/migrations/", import.meta.url));
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => ({
      name: entry.name,
      ...migrationScriptChecksums(readFileSync(new URL(
        `../../prisma/migrations/${entry.name}/migration.sql`, import.meta.url,
      ), "utf8")),
    })).sort((a, b) => a.name.localeCompare(b.name));
}

export const payoutColumns = [
  ["challenges", "announcementChannelId", "text", "YES"],
  ["challenge_progress", "announcementClaimedAt", "timestamp without time zone", "YES"],
  ["challenge_progress", "announcementClaimToken", "text", "YES"],
  ["challenge_progress", "announcementSentAt", "timestamp without time zone", "YES"],
  ["challenge_progress", "completedAt", "timestamp without time zone", "YES"],
  ["challenge_progress", "rewardGivenAt", "timestamp without time zone", "YES"],
  ["guild_members", "xp", "integer", "NO"],
  ["guild_members", "level", "integer", "NO"],
  ["guild_members", "xpToday", "integer", "NO"],
  ["member_xp", "totalXp", "integer", "NO"],
  ["xp_transactions", "amount", "integer", "NO"],
] as const;

/** All server checks share one read-only snapshot. No fixture writes here. */
export async function preflightPayoutDatabase(
  client: PrismaClient,
  manifest?: MigrationManifest,
): Promise<void> {
  let stage: PreflightStage = "local migration manifest";
  try {
    const migrations = manifest ?? payoutMigrationManifest();
    if (migrations.length === 0) reject("LOCAL_MIGRATION_MANIFEST_FAILURE", stage, "No local migrations were found.");
    stage = "transaction start";
    await client.$transaction(async (tx) => {
      stage = "read-only guard";
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      stage = "database identity";
      const identity = await tx.$queryRaw<Array<{ database: string; schema: string; readonly: string }>>`
        SELECT current_database()::text AS database, current_schema()::text AS schema,
          current_setting('transaction_read_only') AS readonly
      `;
      if (identity.length !== 1 || identity[0].database !== "neondb" || identity[0].schema !== "public") {
        reject("DATABASE_IDENTITY_MISMATCH", stage, "The connection did not confirm neondb/public.");
      }
      if (identity[0].readonly !== "on") reject("READ_ONLY_CHECK_FAILED", stage, "PostgreSQL did not confirm a read-only transaction.");

      stage = "migration history";
      const applied = await tx.$queryRaw<Array<{
        migration_name: string; checksum: string; finished_at: Date | null;
        rolled_back_at: Date | null; applied_steps_count: number;
      }>>`SELECT migration_name, checksum, finished_at, rolled_back_at, applied_steps_count
          FROM public._prisma_migrations`;
      for (const expected of migrations) {
        const name = safeLocalName(expected.name);
        const rows = applied.filter((row) => row.migration_name === expected.name);
        if (rows.length === 0) reject("MIGRATION_MISSING", stage, `Required local migration ${name} is absent.`);
        // Prisma retains failed attempts after resolve --rolled-back, including
        // those resolved automatically by resolve --applied. These are history,
        // not additional applied migrations. A finished AND rolled-back row is
        // contradictory; an unfinished, non-rolled-back row remains unresolved.
        if (rows.some((row) => row.finished_at && row.rolled_back_at)) {
          reject("MIGRATION_HISTORY_UNEXPECTED", stage, `Migration ${name} has an attempt marked both finished and rolled back.`);
        }
        if (rows.some((row) => !row.finished_at && !row.rolled_back_at)) {
          reject("MIGRATION_INCOMPLETE", stage, `Migration ${name} has an unresolved failed or in-progress attempt.`);
        }
        const effective = rows.filter((row) => row.finished_at && !row.rolled_back_at);
        if (effective.length === 0) reject("MIGRATION_INCOMPLETE", stage,
          `Migration ${name} has no effective applied record; rolled-back attempts alone are insufficient.`);
        if (effective.length !== 1) reject("MIGRATION_HISTORY_UNEXPECTED", stage,
          `Migration ${name} has multiple effective applied records.`);
        const row = effective[0];
        if (row.checksum !== expected.checksum) {
          const hint = expected.lineEndingChecksums?.includes(row.checksum)
            ? " Only LF/CRLF line endings differ; strict byte-checksum policy still blocks this run."
            : " Local SQL bytes differ from the recorded checksum.";
          reject("MIGRATION_CHECKSUM_MISMATCH", stage, `Migration ${name} checksum differs.${hint}`);
        }
        // resolve --applied/baselining records completion without executing SQL
        // and leaves steps at zero. Completion + checksum are the history gate;
        // the required live columns/indexes must still pass below before writes.
        if (!Number.isInteger(row.applied_steps_count) || row.applied_steps_count < 0) {
          reject("MIGRATION_EXECUTION_UNVERIFIED", stage, `Migration ${name} has an invalid applied step count.`);
        }
      }
      const localNames = new Set(migrations.map((migration) => migration.name));
      if (applied.some((row) => !localNames.has(row.migration_name))) reject("MIGRATION_HISTORY_UNEXPECTED", stage,
        "Database migration history contains records outside the local manifest, including any rolled-back attempts.");

      stage = "required columns";
      const columns = await tx.$queryRaw<Array<{
        table_name: string; column_name: string; data_type: string; is_nullable: string;
      }>>`SELECT table_name::text AS table_name, column_name::text AS column_name,
            data_type::text AS data_type, is_nullable::text AS is_nullable
          FROM information_schema.columns WHERE table_schema = 'public'`;
      for (const [table, column, type, nullable] of payoutColumns) {
        const found = columns.find((row) => row.table_name === table && row.column_name === column);
        if (!found) reject("REQUIRED_COLUMN_MISSING", stage, `Required public.${table}.${column} is missing or not visible to this role.`);
        if (found.data_type !== type || found.is_nullable !== nullable) reject("REQUIRED_COLUMN_MISMATCH", stage,
          `Required public.${table}.${column} has an unexpected type or nullability.`);
      }

      stage = "required indexes";
      const indexes = await tx.$queryRaw<Array<{ indexname: string; valid: boolean }>>`
        SELECT c.relname::text AS indexname, i.indisvalid AS valid
        FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
      `;
      for (const name of [
        "challenge_progress_challengeId_memberId_key",
        "challenge_progress_guildId_memberId_announcementSentAt_idx",
        "member_xp_memberId_key",
      ]) {
        if (!indexes.some((row) => row.indexname === name && row.valid)) reject("REQUIRED_INDEX_MISSING_OR_INVALID", stage,
          `Required public.${name} is missing or invalid.`);
      }
      stage = "transaction commit";
    }, { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 15_000 });
  } catch (error) {
    if (error instanceof PayoutPreflightError) throw error;
    if (stage === "local migration manifest") reject("LOCAL_MIGRATION_MANIFEST_FAILURE", stage, "Local migration files could not be read.");
    throw driverFailure(error, stage);
  }
}
