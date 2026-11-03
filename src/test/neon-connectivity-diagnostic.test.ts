import { EventEmitter } from "node:events";

import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const network = vi.hoisted(() => ({ tcp: vi.fn(), tls: vi.fn(), dns: vi.fn() }));
vi.mock("node:net", () => ({ createConnection: network.tcp }));
vi.mock("node:tls", () => ({ connect: network.tls }));
vi.mock("node:dns/promises", () => ({ lookup: network.dns }));

import { diagnoseNeonConnectivity, diagnoseProductionNeonConnectivity, probePostgresTls, type DiagnosticDependencies } from "./neon-connectivity-diagnostic";
import { PAYOUT_TEST_HOST, PayoutPreflightError } from "./payout-postgres-preflight";
import { PRODUCTION_NEON_HOST, productionDiagnosticUrl } from "./production-neon-target";

const url = `postgresql://fixture:private-password@${PAYOUT_TEST_HOST}/neondb?sslmode=require`;
const env = () => ({ KOMU_DATABASE_TARGET: "neon-test", KOMU_NEON_TEST_DATABASE_URL: url, NODE_ENV: "test" });

function dependencies() {
  const rows = [{ value: 1, database: "neondb", schema: "public", readonly: "on" }];
  const statements: string[] = [];
  const transaction = {
    $executeRaw: vi.fn(async (sql: TemplateStringsArray) => {
      expect(sql.join("")).toBe("SET TRANSACTION READ ONLY");
      statements.push(sql.join(""));
      return 0;
    }),
    $queryRaw: vi.fn(async (sql: TemplateStringsArray) => {
      expect(statements[0]).toBe("SET TRANSACTION READ ONLY");
      expect(sql.join("")).toContain("SELECT 1::int");
      statements.push(sql.join(""));
      return rows;
    }),
  };
  const client = {
    $connect: vi.fn(async () => {}),
    $disconnect: vi.fn(async () => {}),
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<void>) => callback(transaction)),
  };
  const deps = {
    lookup: vi.fn(async () => [{ address: "192.0.2.1", family: 4 }, { address: "2001:db8::1", family: 6 }]),
    probe: vi.fn<DiagnosticDependencies["probe"]>(async () => ({ tcp: true, tls: true })),
    client: vi.fn<DiagnosticDependencies["client"]>(() => client as unknown as PrismaClient),
    preflight: vi.fn(async () => {}),
  } satisfies DiagnosticDependencies;
  return { deps, client, rows, transaction, statements };
}

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe("operator-only Neon diagnostic", () => {
  it("checks every layer with no fixture writes, retries, or secret output", async () => {
    const db = dependencies();
    const input = env();
    const report = await diagnoseNeonConnectivity(input, db.deps);
    expect(report).toMatchObject({
      ok: true, configuration: true, dns: true, ipv4Records: 1, ipv6Records: 1,
      prismaConnect: true, authentication: true, select: true, identity: true,
      preflight: true, disconnect: true, connectTimeoutSeconds: 5, poolTimeoutSeconds: 10,
    });
    expect(db.client.$connect).toHaveBeenCalledTimes(1);
    expect(db.client.$transaction).toHaveBeenCalledTimes(1);
    expect(db.client.$transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 10_000, timeout: 15_000 });
    expect(db.deps.preflight).toHaveBeenCalledTimes(1);
    expect(db.client.$disconnect).toHaveBeenCalledTimes(1);
    expect(new URL(db.deps.client.mock.calls[0][0]).searchParams.get("sslaccept")).toBe("strict");
    expect(input).toEqual(env());
    expect(JSON.stringify(report)).not.toMatch(/private-password|postgresql:|fixture:|192\.0\.2|2001:db8/);
  });
  it("does no networking or client construction for an unapproved target", async () => {
    const db = dependencies();
    const report = await diagnoseNeonConnectivity({ ...env(), KOMU_NEON_TEST_DATABASE_URL: url.replace(PAYOUT_TEST_HOST, "other.neon.tech") }, db.deps);
    expect(report.failure?.category).toBe("ENDPOINT_IDENTITY_MISMATCH");
    expect(db.deps.lookup).not.toHaveBeenCalled();
    expect(db.deps.probe).not.toHaveBeenCalled();
    expect(db.deps.client).not.toHaveBeenCalled();
  });
  it("bounds DNS lookups and never continues on failure", async () => {
    vi.useFakeTimers();
    const db = dependencies();
    db.deps.lookup.mockReturnValueOnce(new Promise(() => {}));
    const pending = diagnoseNeonConnectivity(env(), db.deps);
    await vi.advanceTimersByTimeAsync(5_001);
    expect(await pending).toMatchObject({ ok: false, dns: false, authentication: null });
    expect(db.deps.client).not.toHaveBeenCalled();
  });
  it("redacts DNS errors", async () => {
    const db = dependencies();
    db.deps.lookup.mockRejectedValueOnce(new Error("private-password " + url));
    const report = await diagnoseNeonConnectivity(env(), db.deps);
    expect(report.failure?.category).toBe("DNS_FAILED");
    expect(JSON.stringify(report)).not.toContain("private-password");
  });
  it("shows a failed IPv6 path while allowing a successful alternate path", async () => {
    const db = dependencies();
    db.deps.probe.mockResolvedValueOnce({ tcp: true, tls: true })
      .mockResolvedValueOnce({ tcp: false, tls: null });
    const report = await diagnoseNeonConnectivity(env(), db.deps);
    expect(report.ok).toBe(true);
    expect(report.network).toEqual([
      { family: "IPv4", index: 0, tcp: true, tls: true },
      { family: "IPv6", index: 1, tcp: false, tls: null },
    ]);
  });
  it.each([
    ["P1000", "AUTHENTICATION_FAILED", false],
    ["P1001", "UNREACHABLE", null],
    ["P1002", "CONNECTION_TIMEOUT", null],
    ["P1011", "TLS_FAILED", null],
    ["P2024", "POOL_ACQUISITION_TIMEOUT", null],
  ])("distinguishes %s and does not retry authentication", async (code, reason, authentication) => {
    const db = dependencies();
    db.client.$connect.mockRejectedValueOnce(Object.assign(new Error("private-password " + url), { errorCode: code }));
    const report = await diagnoseNeonConnectivity(env(), db.deps);
    expect(report).toMatchObject({ ok: false, prismaConnect: false, authentication, select: null });
    expect(report.failure?.reason).toBe(reason);
    expect(JSON.stringify(report)).not.toContain("private-password");
    expect(db.client.$connect).toHaveBeenCalledTimes(1);
    expect(db.client.$transaction).not.toHaveBeenCalled();
    expect(db.client.$disconnect).toHaveBeenCalledTimes(1);
  });
  it("will not run preflight after an identity mismatch", async () => {
    const db = dependencies();
    db.rows[0].database = "private-password";
    const report = await diagnoseNeonConnectivity(env(), db.deps);
    expect(report).toMatchObject({ ok: false, select: true, identity: false, preflight: null });
    expect(report.failure?.category).toBe("DATABASE_IDENTITY_MISMATCH");
    expect(db.deps.preflight).not.toHaveBeenCalled();
    expect(JSON.stringify(report)).not.toContain("private-password");
  });
  it("retains the full migration/schema preflight gate", async () => {
    const db = dependencies();
    db.deps.preflight.mockRejectedValueOnce(new PayoutPreflightError("MIGRATION_MISSING", "migration history", "fixture migration"));
    const report = await diagnoseNeonConnectivity(env(), db.deps);
    expect(report).toMatchObject({ ok: false, select: true, identity: true, preflight: false });
    expect(report.failure).toMatchObject({ category: "MIGRATION_MISSING", stage: "migration history" });
  });
  it("rejects a SELECT session that is not read-only", async () => {
    const db = dependencies();
    db.rows[0].readonly = "off";
    const report = await diagnoseNeonConnectivity(env(), db.deps);
    expect(report).toMatchObject({ ok: false, failure: { category: "READ_ONLY_CHECK_FAILED" } });
    expect(db.deps.preflight).not.toHaveBeenCalled();
    expect(db.client.$disconnect).toHaveBeenCalledTimes(1);
  });
  it("does not replay a failed SELECT transaction", async () => {
    const db = dependencies();
    db.client.$transaction.mockRejectedValueOnce({ code: "P2028", message: "private-password" });
    const report = await diagnoseNeonConnectivity(env(), db.deps);
    expect(report).toMatchObject({ ok: false, failure: { reason: "TRANSACTION_FAILURE" } });
    expect(db.client.$transaction).toHaveBeenCalledTimes(1);
    expect(db.deps.preflight).not.toHaveBeenCalled();
    expect(JSON.stringify(report)).not.toContain("private-password");
  });
  it("sanitizes disconnect failures and does not claim a clean run", async () => {
    const db = dependencies();
    db.client.$disconnect.mockRejectedValueOnce(new Error("private-password " + url));
    const report = await diagnoseNeonConnectivity(env(), db.deps);
    expect(report).toMatchObject({ ok: false, disconnect: false, failure: { reason: "DISCONNECT_FAILED" } });
    expect(JSON.stringify(report)).not.toContain("private-password");
  });
  it("keeps timeout adjustments explicit, bounded, and in memory", async () => {
    const db = dependencies();
    const input = env();
    const report = await diagnoseNeonConnectivity(input, db.deps, true);
    expect(report).toMatchObject({ connectTimeoutSeconds: 15, poolTimeoutSeconds: 15, preflightMaxWaitMs: 10_000 });
    expect(input).toEqual(env());
    const selected = new URL(db.deps.client.mock.calls[0][0]);
    expect(selected.hostname).toBe(PAYOUT_TEST_HOST);
    expect(selected.pathname).toBe("/neondb");
    expect(selected.searchParams.get("connect_timeout")).toBe("15");
  });
  it("does not claim success if all verified TLS probes fail", async () => {
    const db = dependencies();
    db.deps.probe.mockResolvedValue({ tcp: true, tls: false });
    expect(await diagnoseNeonConnectivity(env(), db.deps)).toMatchObject({
      ok: false, failure: { category: "TLS_PROBE_FAILED" },
    });
  });
});

function socketMock() {
  return Object.assign(new EventEmitter(), { write: vi.fn(), destroy: vi.fn(), authorized: true });
}

const productionUrl = `postgresql://fixture:p%40ss%25word@${PRODUCTION_NEON_HOST}/neondb?sslmode=require&connect_timeout=20&pool_timeout=20`;
const productionEnv = () => ({
  NODE_ENV: "production",
  KOMU_EXPECTED_PRODUCTION_HOST: PRODUCTION_NEON_HOST,
  KOMU_PRODUCTION_DIAGNOSTIC_DATABASE_URL: productionUrl,
});

describe("explicit production connectivity (no migration approval)", () => {
  it("pins DNS, TLS and the client to production while leaving pending-schema checks separate", async () => {
    const db = dependencies();
    const input = productionEnv();
    const report = await diagnoseProductionNeonConnectivity(input, db.deps);
    expect(report).toMatchObject({
      ok: true, target: "production", hostname: PRODUCTION_NEON_HOST,
      connectTimeoutSeconds: 20, poolTimeoutSeconds: 20, identity: true,
      payoutPreflightApplicable: false, preflight: null, migrationApproved: false,
      strictTlsOptionAppended: true,
    });
    expect(db.deps.lookup).toHaveBeenCalledExactlyOnceWith(PRODUCTION_NEON_HOST);
    expect(db.deps.probe).toHaveBeenCalledWith(expect.any(Object), PRODUCTION_NEON_HOST);
    expect(db.deps.client).toHaveBeenCalledExactlyOnceWith(productionUrl + "&sslaccept=strict");
    expect(db.deps.preflight).not.toHaveBeenCalled();
    expect(db.client.$transaction).toHaveBeenCalledTimes(1);
    expect(input).toEqual(productionEnv());
    expect(JSON.stringify(report)).not.toMatch(/p%40ss|fixture:|postgresql:/);
  });
  it.each([
    {}, { DATABASE_URL: productionUrl },
    { ...productionEnv(), NODE_ENV: "test" },
    { ...productionEnv(), KOMU_EXPECTED_PRODUCTION_HOST: PAYOUT_TEST_HOST },
    { ...productionEnv(), KOMU_DATABASE_TARGET: "neon-test" },
    { ...productionEnv(), KOMU_NEON_TEST_DATABASE_URL: productionUrl },
    ...[
      productionUrl.replace(PRODUCTION_NEON_HOST, PAYOUT_TEST_HOST),
      productionUrl.replace("/neondb", "/other"),
      productionUrl + "&schema=private",
      productionUrl + "&host=other.neon.tech",
      productionUrl + "&schema=public&schema=public",
      productionUrl.replace("sslmode=require", "sslmode=verify-full"),
      productionUrl.replace("sslmode=require", "sslmode%3Drequire%26schema%3Dpublic"),
      productionUrl + "&sslaccept=accept_invalid_certs",
      productionUrl + "&connect_timeout=0",
    ].map((value) => ({ ...productionEnv(), KOMU_PRODUCTION_DIAGNOSTIC_DATABASE_URL: value })),
  ])("rejects missing/mismatched/redirection configuration before any I/O (case %#)", async (input) => {
    const db = dependencies();
    const report = await diagnoseProductionNeonConnectivity(input, db.deps);
    expect(report.configuration).toBe(false);
    expect(report.failure?.category).toBe("INVALID_TARGET_CONFIGURATION");
    expect(db.deps.lookup).not.toHaveBeenCalled();
    expect(db.deps.client).not.toHaveBeenCalled();
  });
  it("preserves original userinfo/query encoding and flags possible double encoding without repairing it", async () => {
    const db = dependencies();
    const original = productionUrl.replace("p%40ss%25word", "p%2540ss") + "&sslaccept=strict";
    const input = { ...productionEnv(), KOMU_PRODUCTION_DIAGNOSTIC_DATABASE_URL: original };
    expect(productionDiagnosticUrl(input)).toBe(original);
    const report = await diagnoseProductionNeonConnectivity(input, db.deps);
    expect(db.deps.client).toHaveBeenCalledExactlyOnceWith(original);
    expect(report.possibleDoubleEncodedUserInfo).toBe(true);
    expect(report.strictTlsOptionAppended).toBe(false);
    expect(JSON.stringify(report)).not.toContain("p%2540ss");
  });
});

describe("credential-free PostgreSQL SSL negotiation", () => {
  it("uses the explicit production SNI when requested by the production path", async () => {
    const socket = socketMock();
    const tls = socketMock();
    network.tcp.mockReturnValue(socket);
    network.tls.mockReturnValue(tls);
    const pending = probePostgresTls({ address: "192.0.2.1", family: 4 }, 5_000, PRODUCTION_NEON_HOST);
    socket.emit("connect");
    socket.emit("data", Buffer.from("S"));
    expect(network.tls).toHaveBeenCalledWith({ socket, servername: PRODUCTION_NEON_HOST, rejectUnauthorized: true });
    tls.emit("secureConnect");
    expect(await pending).toEqual({ tcp: true, tls: true });
  });
  it("sends only SSLRequest and verifies SNI/certificates on the approved host", async () => {
    const socket = socketMock();
    const tls = socketMock();
    network.tcp.mockReturnValue(socket);
    network.tls.mockReturnValue(tls);
    const pending = probePostgresTls({ address: "192.0.2.1", family: 4 });
    socket.emit("connect");
    expect(socket.write).toHaveBeenCalledExactlyOnceWith(Buffer.from("0000000804d2162f", "hex"));
    socket.emit("data", Buffer.from("S"));
    expect(network.tls).toHaveBeenCalledWith({ socket, servername: PAYOUT_TEST_HOST, rejectUnauthorized: true });
    tls.emit("secureConnect");
    expect(await pending).toEqual({ tcp: true, tls: true });
    expect(socket.destroy).toHaveBeenCalledTimes(1);
    expect(tls.destroy).toHaveBeenCalledTimes(1);
  });
  it.each(["N", "SS"])("rejects an unsupported SSL response %s", async (response) => {
    const socket = socketMock();
    network.tcp.mockReturnValue(socket);
    const pending = probePostgresTls({ address: "192.0.2.1", family: 4 });
    socket.emit("connect");
    socket.emit("data", Buffer.from(response));
    expect(await pending).toEqual({ tcp: true, tls: false });
    expect(network.tls).not.toHaveBeenCalled();
  });
  it("reports TCP failure without claiming a TLS attempt", async () => {
    const socket = socketMock();
    network.tcp.mockReturnValue(socket);
    const pending = probePostgresTls({ address: "2001:db8::1", family: 6 });
    socket.emit("error", new Error("private-password"));
    expect(await pending).toEqual({ tcp: false, tls: null });
  });
  it("bounds stalled TLS and destroys the socket", async () => {
    vi.useFakeTimers();
    const socket = socketMock();
    network.tcp.mockReturnValue(socket);
    const pending = probePostgresTls({ address: "192.0.2.1", family: 4 });
    socket.emit("connect");
    await vi.advanceTimersByTimeAsync(5_001);
    expect(await pending).toEqual({ tcp: true, tls: false });
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });
  it.each(["error", "unauthorized"])("never accepts TLS %s", async (failure) => {
    const socket = socketMock();
    const tls = socketMock();
    network.tcp.mockReturnValue(socket);
    network.tls.mockReturnValue(tls);
    const pending = probePostgresTls({ address: "192.0.2.1", family: 4 });
    socket.emit("connect");
    socket.emit("data", Buffer.from("S"));
    if (failure === "error") tls.emit("error", new Error("private-password"));
    else { tls.authorized = false; tls.emit("secureConnect"); }
    expect(await pending).toEqual({ tcp: true, tls: false });
    expect(tls.destroy).toHaveBeenCalledTimes(1);
  });
});
