import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import payoutConfig from "../../vitest.payout.config";
import {
  PAYOUT_TEST_HOST, PayoutPreflightError, databaseFailureKind, migrationScriptChecksums,
  payoutColumns, payoutMigrationManifest, payoutTestUrl, preflightPayoutDatabase,
} from "./payout-postgres-preflight";

// Synthetic credentials only. No environment files or live clients in this suite.
const url = `postgresql://fixture:synthetic@${PAYOUT_TEST_HOST}/neondb?sslmode=require&schema=public`;
const env = () => ({ KOMU_DATABASE_TARGET: "neon-test", KOMU_NEON_TEST_DATABASE_URL: url, NODE_ENV: "test" });

describe("payout PostgreSQL URL gate", () => {
  it("disables automatic env-file loading and includes only payout integration tests", () => {
    expect(payoutConfig.envDir).toBe(false);
    expect(payoutConfig.test?.include).toEqual(["src/lib/challenges/grant-completion.integration.test.ts"]);
  });
  it("accepts only the selected endpoint without changing the environment", () => {
    const input = env();
    expect(payoutTestUrl(input)).toBe(url);
    expect(input).toEqual(env());
    expect(payoutTestUrl({ ...input, DATABASE_URL: url })).toBe(url);
  });
  it.each([
    {}, { DATABASE_URL: url },
    { ...env(), KOMU_DATABASE_TARGET: "default" },
    { ...env(), NODE_ENV: "production" },
    { ...env(), KOMU_NEON_TEST_DATABASE_URL: undefined, DATABASE_URL: url },
    { ...env(), KOMU_NEON_TEST_DATABASE_URL: "malformed" },
    ...[
      url.replace(PAYOUT_TEST_HOST, "another.neon.tech"),
      url.replace(PAYOUT_TEST_HOST, PAYOUT_TEST_HOST.replace(".c-7", "-pooler.c-7")),
      url.replace("/neondb", "/other"),
      url.replace("schema=public", "schema=private"),
      url.replace("sslmode=require", "sslmode=disable"),
      url.replace("sslmode=require", "sslmode=verify-full"),
      url + "&sslaccept=accept_invalid_certs",
      url + "&host=another.neon.tech",
      url + "&options=-csearch_path%3Dprivate",
      url + "&schema=public",
      url + "&connection_limit=1",
      url + "&connect_timeout=0",
      url.replace("synthetic", "bad%ZZ"),
    ].map((value) => ({ ...env(), KOMU_NEON_TEST_DATABASE_URL: value })),
    { ...env(), DATABASE_URL: "conflicting-value" },
  ])("fails closed before client construction (case %#)", (input) => {
    let constructed = false;
    expect(() => { payoutTestUrl(input); constructed = true; }).toThrow();
    expect(constructed).toBe(false);
  });
  it("does not include input secrets in errors", () => {
    try {
      payoutTestUrl({ ...env(), KOMU_NEON_TEST_DATABASE_URL: "private-marker" });
      expect.fail("Expected rejection");
    } catch (error) {
      expect(String(error)).not.toContain("private-marker");
      expect(String(error)).not.toContain(url);
    }
  });
  it("distinguishes invalid configuration from an endpoint identity mismatch", () => {
    expect(() => payoutTestUrl({})).toThrow("[INVALID_TARGET_CONFIGURATION]");
    expect(() => payoutTestUrl({ ...env(), KOMU_NEON_TEST_DATABASE_URL: url.replace(PAYOUT_TEST_HOST, "other.neon.tech") }))
      .toThrow("[ENDPOINT_IDENTITY_MISMATCH]");
    expect(() => payoutTestUrl({ ...env(), DATABASE_URL: "private-marker" }))
      .toThrow("[INVALID_TARGET_CONFIGURATION]");
  });
  it("accepts Prisma's supported strict TLS certificate setting", () => {
    const strict = url + "&sslaccept=strict";
    expect(payoutTestUrl({ ...env(), KOMU_NEON_TEST_DATABASE_URL: strict })).toBe(strict);
  });
  it.each([
    ["P1000", "AUTHENTICATION_FAILED"], ["P1001", "UNREACHABLE"],
    ["P1002", "CONNECTION_TIMEOUT"], ["P1011", "TLS_FAILED"],
    ["P2024", "POOL_ACQUISITION_TIMEOUT"], ["private-marker", "UNKNOWN"],
  ])("classifies %s without raw messages", (errorCode, expected) => {
    expect(databaseFailureKind({ errorCode, message: "private-marker " + url })).toBe(expected);
  });
});

const manifest = [{ name: "fixture_migration", checksum: "fixture-checksum" }];
function readOnlyClient() {
  const identity = [{ database: "neondb", schema: "public", readonly: "on" }];
  const migrations = [{
    migration_name: manifest[0].name, checksum: manifest[0].checksum,
    finished_at: new Date() as Date | null, rolled_back_at: null as Date | null, applied_steps_count: 1,
  }];
  const columns = payoutColumns.map(([table_name, column_name, data_type, is_nullable]) =>
    ({ table_name: String(table_name), column_name: String(column_name), data_type: String(data_type), is_nullable: String(is_nullable) }));
  const indexes = [
    "challenge_progress_challengeId_memberId_key",
    "challenge_progress_guildId_memberId_announcementSentAt_idx",
    "member_xp_memberId_key",
  ].map((indexname) => ({ indexname, valid: true }));
  const calls: string[] = [];
  const tx = {
    $executeRaw: vi.fn(async (sql: TemplateStringsArray) => {
      const statement = sql.join("?");
      expect(statement).toBe("SET TRANSACTION READ ONLY");
      expect(calls).toEqual([]);
      calls.push(statement);
      return 0;
    }),
    $queryRaw: vi.fn(async (sql: TemplateStringsArray) => {
      expect(calls[0]).toBe("SET TRANSACTION READ ONLY");
      const statement = sql.join("?");
      expect(statement.trim()).toMatch(/^SELECT /);
      calls.push(statement);
      if (statement.includes("current_database()")) return identity;
      if (statement.includes("_prisma_migrations")) return migrations;
      if (statement.includes("information_schema.columns")) return columns;
      if (statement.includes("pg_index")) return indexes;
      throw new Error("Unexpected SQL");
    }),
  };
  const client = {
    $transaction: vi.fn(async (body: (transaction: typeof tx) => Promise<void>) => body(tx)),
  } as unknown as PrismaClient;
  return { client, tx, identity, migrations, columns, indexes, calls };
}

describe("read-only payout database preflight", () => {
  it("checks one read-only snapshot before authorizing any fixture", async () => {
    const db = readOnlyClient();
    await preflightPayoutDatabase(db.client, manifest);
    expect(db.calls).toHaveLength(5);
    expect(db.client.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 15_000,
    });
  });
  it.each([
    { steps: 1, retired: 1, reverse: false },
    { steps: 1, retired: 2, reverse: true },
    { steps: 0, retired: 0, reverse: false },
    { steps: 0, retired: 1, reverse: true },
    { steps: 0, retired: 2, reverse: false },
  ])("accepts one applied state with $steps steps and $retired resolved attempts", async ({ steps, retired, reverse }) => {
    const db = readOnlyClient();
    db.migrations[0].applied_steps_count = steps;
    const success = { ...db.migrations[0] };
    db.migrations.splice(0, 1, ...Array.from({ length: retired }, () => ({
      ...success, finished_at: null, rolled_back_at: new Date(),
      // Failed, explicitly abandoned SQL need not match the eventual applied SQL.
      checksum: "retired-attempt-bytes", applied_steps_count: 0,
    })), success);
    if (reverse) db.migrations.reverse();
    await preflightPayoutDatabase(db.client, manifest);
    // Resolving history never bypasses required live schema verification.
    expect(db.calls).toHaveLength(5);
    expect(db.calls[3]).toContain("information_schema.columns");
    expect(db.calls[4]).toContain("pg_index");
  });
  it.each([
    {
      code: "MIGRATION_INCOMPLETE",
      mutate: (db: ReturnType<typeof readOnlyClient>) => {
        db.migrations.push({ ...db.migrations[0], finished_at: null, rolled_back_at: null });
      },
    },
    {
      code: "MIGRATION_HISTORY_UNEXPECTED",
      mutate: (db: ReturnType<typeof readOnlyClient>) => {
        db.migrations.push({ ...db.migrations[0], checksum: "different-successful-sql" });
      },
    },
    {
      code: "MIGRATION_INCOMPLETE",
      mutate: (db: ReturnType<typeof readOnlyClient>) => {
        db.migrations[0].finished_at = null;
        db.migrations[0].rolled_back_at = new Date();
        db.migrations.push({ ...db.migrations[0] });
      },
    },
    {
      code: "MIGRATION_HISTORY_UNEXPECTED",
      mutate: (db: ReturnType<typeof readOnlyClient>) => {
        db.migrations.push({ ...db.migrations[0], rolled_back_at: new Date() });
      },
    },
    {
      code: "MIGRATION_CHECKSUM_MISMATCH",
      mutate: (db: ReturnType<typeof readOnlyClient>) => {
        db.migrations.push({ ...db.migrations[0], finished_at: null, rolled_back_at: new Date() });
        db.migrations[0].checksum = "wrong-effective-checksum";
      },
    },
    {
      code: "MIGRATION_HISTORY_UNEXPECTED",
      mutate: (db: ReturnType<typeof readOnlyClient>) => {
        db.migrations.push({
          ...db.migrations[0], migration_name: "unknown-retired-migration",
          finished_at: null, rolled_back_at: new Date(),
        });
      },
    },
  ])("rejects unsafe multiple-row history: $code (case %#)", async ({ code, mutate }) => {
    const db = readOnlyClient();
    mutate(db);
    const writeFixture = vi.fn();
    await expect((async () => {
      await preflightPayoutDatabase(db.client, manifest);
      writeFixture();
    })()).rejects.toMatchObject({ code, stage: "migration history" });
    expect(writeFixture).not.toHaveBeenCalled();
    expect(db.calls.some((query) => query.includes("information_schema.columns"))).toBe(false);
  });
  it.each(["column", "index"])("still blocks resolved history when a required %s is missing", async (missing) => {
    const db = readOnlyClient();
    db.migrations[0].applied_steps_count = 0;
    db.migrations.push({ ...db.migrations[0], finished_at: null, rolled_back_at: new Date() });
    if (missing === "column") db.columns.pop();
    else db.indexes.pop();
    const writeFixture = vi.fn();
    await expect((async () => {
      await preflightPayoutDatabase(db.client, manifest);
      writeFixture();
    })()).rejects.toMatchObject({
      code: missing === "column" ? "REQUIRED_COLUMN_MISSING" : "REQUIRED_INDEX_MISSING_OR_INVALID",
    });
    expect(writeFixture).not.toHaveBeenCalled();
  });
  it.each([
    { code: "DATABASE_IDENTITY_MISMATCH", mutate: (db: ReturnType<typeof readOnlyClient>) => { db.identity[0].database = "private-marker"; } },
    { code: "DATABASE_IDENTITY_MISMATCH", mutate: (db: ReturnType<typeof readOnlyClient>) => { db.identity[0].schema = "private-marker"; } },
    { code: "READ_ONLY_CHECK_FAILED", mutate: (db: ReturnType<typeof readOnlyClient>) => { db.identity[0].readonly = "off"; } },
    { code: "MIGRATION_MISSING", mutate: (db: ReturnType<typeof readOnlyClient>) => { db.migrations.pop(); } },
    { code: "MIGRATION_CHECKSUM_MISMATCH", mutate: (db: ReturnType<typeof readOnlyClient>) => { db.migrations[0].checksum = "private-marker"; } },
    { code: "MIGRATION_INCOMPLETE", mutate: (db: ReturnType<typeof readOnlyClient>) => { db.migrations[0].finished_at = null; } },
    { code: "MIGRATION_HISTORY_UNEXPECTED", mutate: (db: ReturnType<typeof readOnlyClient>) => { db.migrations[0].rolled_back_at = new Date(); } },
    { code: "MIGRATION_EXECUTION_UNVERIFIED", mutate: (db: ReturnType<typeof readOnlyClient>) => { db.migrations[0].applied_steps_count = -1; } },
    { code: "MIGRATION_HISTORY_UNEXPECTED", mutate: (db: ReturnType<typeof readOnlyClient>) => { db.migrations.push({ ...db.migrations[0] }); } },
    { code: "MIGRATION_HISTORY_UNEXPECTED", mutate: (db: ReturnType<typeof readOnlyClient>) => { db.migrations.push({ ...db.migrations[0], migration_name: "private-marker" }); } },
    { code: "REQUIRED_COLUMN_MISSING", mutate: (db: ReturnType<typeof readOnlyClient>) => { db.columns.pop(); } },
    { code: "REQUIRED_COLUMN_MISMATCH", mutate: (db: ReturnType<typeof readOnlyClient>) => { db.columns[0].data_type = "private-marker"; } },
    { code: "REQUIRED_COLUMN_MISMATCH", mutate: (db: ReturnType<typeof readOnlyClient>) => { db.columns[0].is_nullable = "NO"; } },
    { code: "REQUIRED_INDEX_MISSING_OR_INVALID", mutate: (db: ReturnType<typeof readOnlyClient>) => { db.indexes.pop(); } },
    { code: "REQUIRED_INDEX_MISSING_OR_INVALID", mutate: (db: ReturnType<typeof readOnlyClient>) => { db.indexes[0].valid = false; } },
  ])("blocks fixture authorization with $code (case %#)", async ({ code, mutate }) => {
    const db = readOnlyClient();
    mutate(db);
    const writeFixture = vi.fn();
    const error = await (async () => {
      await preflightPayoutDatabase(db.client, manifest);
      writeFixture();
    })().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(PayoutPreflightError);
    expect(error).toMatchObject({ code });
    expect(String(error)).toContain("No fixture writes authorized");
    expect(String(error)).not.toContain("private-marker");
    expect(error).not.toHaveProperty("cause");
    expect(writeFixture).not.toHaveBeenCalled();
  });
  it("redacts unrecognized driver errors and rejects missing migration manifests", async () => {
    const db = readOnlyClient();
    db.tx.$queryRaw.mockRejectedValueOnce(new Error("private-driver-connection-details"));
    await expect(preflightPayoutDatabase(db.client, manifest)).rejects.toThrow(
      "[METADATA_QUERY_FAILURE] (database identity)",
    );
    const empty = readOnlyClient();
    await expect(preflightPayoutDatabase(empty.client, [])).rejects.toThrow("[LOCAL_MIGRATION_MANIFEST_FAILURE]");
    expect(empty.client.$transaction).not.toHaveBeenCalled();
  });
  it.each([
    { driver: { code: "P1001" }, code: "DATABASE_CONNECTIVITY_FAILURE" },
    { driver: { code: "P1000" }, code: "DATABASE_CONNECTIVITY_FAILURE" },
    { driver: { errorCode: "P1011" }, code: "DATABASE_CONNECTIVITY_FAILURE" },
    { driver: { code: "P2024" }, code: "DATABASE_CONNECTIVITY_FAILURE" },
    { driver: { code: "P2010", meta: { code: "08006" } }, code: "DATABASE_CONNECTIVITY_FAILURE" },
    { driver: { code: "P2010", meta: { code: "28P01" } }, code: "DATABASE_CONNECTIVITY_FAILURE" },
    { driver: { code: "P1010" }, code: "DATABASE_PERMISSION_DENIED" },
    { driver: { code: "P2010", meta: { code: "42501" } }, code: "DATABASE_PERMISSION_DENIED" },
    { driver: { code: "P2028" }, code: "DATABASE_TRANSACTION_FAILURE" },
    { driver: { code: "P2010", meta: { code: "40P01" } }, code: "DATABASE_TRANSACTION_FAILURE" },
    { driver: { code: "unknown-private-marker" }, code: "METADATA_QUERY_FAILURE" },
  ])("classifies $code without disclosing driver details (case %#)", async ({ driver, code }) => {
    const db = readOnlyClient();
    vi.mocked(db.client.$transaction).mockRejectedValueOnce(
      Object.assign(new Error("private-marker " + url), driver, { clientVersion: "private-marker" }),
    );
    const error = await preflightPayoutDatabase(db.client, manifest).catch((error: unknown) => error);
    expect(error).toMatchObject({ code, stage: "transaction start" });
    expect(String(error)).not.toContain("private-marker");
    expect(String(error)).not.toContain(url);
    expect(error).not.toHaveProperty("cause");
    expect(db.calls).toEqual([]);
  });
  it("identifies a missing migration history table by SQLSTATE, not raw text", async () => {
    const db = readOnlyClient();
    db.tx.$queryRaw.mockImplementationOnce(async () => db.identity).mockRejectedValueOnce({
      code: "P2010", meta: { code: "42P01", message: "private-marker " + url },
    });
    await expect(preflightPayoutDatabase(db.client, manifest)).rejects.toMatchObject({
      code: "MIGRATION_HISTORY_MISSING", stage: "migration history",
    });
    expect(db.calls).toHaveLength(1);
  });
  it("distinguishes line-ending-only differences without allowing them through", async () => {
    const db = readOnlyClient();
    const hashes = migrationScriptChecksums("SELECT 1;\n");
    db.migrations[0].checksum = migrationScriptChecksums("SELECT 1;\r\n").checksum;
    const local = [{ name: manifest[0].name, ...hashes }];
    await expect(preflightPayoutDatabase(db.client, local)).rejects.toThrow("Only LF/CRLF line endings differ");
    db.migrations[0].checksum = migrationScriptChecksums("SELECT 2;\n").checksum;
    await expect(preflightPayoutDatabase(readOnlyClient().client, [{
      name: manifest[0].name, ...migrationScriptChecksums("SELECT 2;\n"),
    }])).rejects.toThrow("Local SQL bytes differ");
  });
  it("rejects commit failures after checks pass, rather than authorizing fixtures", async () => {
    const db = readOnlyClient();
    vi.mocked(db.client.$transaction).mockImplementationOnce(async (callback: unknown) => {
      await (callback as (tx: typeof db.tx) => Promise<void>)(db.tx);
      throw { code: "P2028", message: "private-marker" };
    });
    await expect(preflightPayoutDatabase(db.client, manifest)).rejects.toMatchObject({
      code: "DATABASE_TRANSACTION_FAILURE", stage: "transaction commit",
    });
  });
  it("hashes all local migrations, including announcement schema dependencies", () => {
    const local = payoutMigrationManifest();
    expect(local.length).toBeGreaterThan(0);
    expect(local).toContainEqual(expect.objectContaining({
      name: "20261029120000_challenge_completion_announcements",
      checksum: "a64e08838c0b44206f0c7a42ec07d573f1e9db06132a7509b05accf839c6c970",
    }));
    expect(local.every((entry) => /^[a-f0-9]{64}$/.test(entry.checksum))).toBe(true);
  });
});
