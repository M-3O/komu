import { lookup } from "node:dns/promises";
import { createConnection, type Socket } from "node:net";
import { connect as connectTls, type TLSSocket } from "node:tls";

import { PrismaClient } from "@prisma/client";

import {
  PAYOUT_TEST_HOST, PayoutPreflightError, databaseFailureKind, payoutTestUrl, preflightPayoutDatabase,
} from "./payout-postgres-preflight";

type Address = { address: string; family: number };
type Probe = { tcp: boolean; tls: boolean | null };
export type DiagnosticDependencies = {
  lookup: () => Promise<Address[]>;
  probe: (address: Address) => Promise<Probe>;
  client: (url: string) => PrismaClient;
  preflight: (client: PrismaClient) => Promise<void>;
};

/** No credential/startup packet is sent: SSLRequest, then verified TLS only. */
export function probePostgresTls(address: Address, deadlineMs = 5_000): Promise<Probe> {
  return new Promise((resolve) => {
    let socket: Socket | undefined;
    let secure: TLSSocket | undefined;
    let tcp = false;
    let done = false;
    const finish = (tls: boolean | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      secure?.destroy();
      socket?.destroy();
      resolve({ tcp, tls });
    };
    const timer = setTimeout(() => finish(tcp ? false : null), deadlineMs);
    try {
      socket = createConnection({ host: address.address, family: address.family, port: 5432 });
      socket.once("error", () => finish(tcp ? false : null));
      socket.once("close", () => finish(tcp ? false : null));
      socket.once("connect", () => {
        tcp = true;
        const request = Buffer.alloc(8);
        request.writeInt32BE(8, 0);
        request.writeInt32BE(80877103, 4);
        socket!.once("data", (response: Buffer) => {
          if (response.length !== 1 || response[0] !== 83) { finish(false); return; }
          try {
            secure = connectTls({
              socket, servername: PAYOUT_TEST_HOST, rejectUnauthorized: true,
            });
            secure.once("error", () => finish(false));
            secure.once("close", () => finish(false));
            secure.once("secureConnect", () => finish(secure!.authorized));
          } catch { finish(false); }
        });
        socket!.write(request);
      });
    } catch { finish(tcp ? false : null); }
  });
}

const defaults: DiagnosticDependencies = {
  lookup: () => lookup(PAYOUT_TEST_HOST, { all: true, verbatim: true }),
  probe: probePostgresTls,
  client: (url) => new PrismaClient({ datasourceUrl: url, log: [] }),
  preflight: preflightPayoutDatabase,
};

async function boundedLookup(dependencies: DiagnosticDependencies): Promise<Address[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      dependencies.lookup(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("DNS deadline")), 5_000); }),
    ]);
  } finally { clearTimeout(timer); }
}

/** Importing this module performs no I/O. Only the dedicated operator CLI calls it. */
export async function diagnoseNeonConnectivity(
  env: Readonly<Record<string, string | undefined>>,
  dependencies: DiagnosticDependencies = defaults,
  extendedTimeouts = false,
) {
  const report = {
    ok: false,
    target: "neon-test", hostname: PAYOUT_TEST_HOST, database: "neondb", schema: "public",
    configuration: false,
    prismaStrictTls: true,
    connectTimeoutSeconds: 0, poolTimeoutSeconds: 0,
    preflightMaxWaitMs: 10_000, preflightTransactionTimeoutMs: 15_000,
    dns: null as boolean | null, ipv4Records: 0, ipv6Records: 0, addressesTruncated: false,
    network: [] as Array<Probe & { family: "IPv4" | "IPv6"; index: number }>,
    prismaConnect: null as boolean | null, authentication: null as boolean | null,
    select: null as boolean | null, identity: null as boolean | null,
    preflight: null as boolean | null, disconnect: null as boolean | null,
    prismaConnectMs: 0,
    failure: null as null | { category: string; stage: string; reason: string },
  };
  let client: PrismaClient | undefined;
  let stage = "configuration";
  try {
    const original = payoutTestUrl(env); // Before DNS, sockets, or client construction.
    const url = new URL(original);
    // Verify endpoint certificates before sending credentials, even when the
    // supplied Prisma URL only requires encryption. In-memory diagnostic only.
    url.searchParams.set("sslaccept", "strict");
    if (extendedTimeouts) {
      url.searchParams.set("connect_timeout", "15");
      url.searchParams.set("pool_timeout", "15");
    }
    report.configuration = true;
    report.connectTimeoutSeconds = Number(url.searchParams.get("connect_timeout") ?? "5");
    report.poolTimeoutSeconds = Number(url.searchParams.get("pool_timeout") ?? "10");
    stage = "DNS";
    let addresses: Address[];
    try {
      addresses = await boundedLookup(dependencies);
      addresses = addresses.filter((entry) => entry.family === 4 || entry.family === 6);
      report.dns = addresses.length > 0;
    } catch {
      report.dns = false;
      report.failure = { category: "DNS_FAILED", stage, reason: "LOOKUP_FAILED_OR_TIMED_OUT" };
      return report;
    }
    if (!report.dns) {
      report.failure = { category: "DNS_FAILED", stage, reason: "NO_ADDRESSES" };
      return report;
    }
    report.ipv4Records = addresses.filter((entry) => entry.family === 4).length;
    report.ipv6Records = addresses.filter((entry) => entry.family === 6).length;
    report.addressesTruncated = addresses.length > 8;
    stage = "TCP/TLS";
    report.network = await Promise.all(addresses.slice(0, 8).map(async (address, index) => ({
      family: address.family === 4 ? "IPv4" as const : "IPv6" as const,
      index, ...await dependencies.probe(address),
    })));
    // Probe failures do not mask Prisma's own resolver/TLS stack. No transaction retries.
    stage = "Prisma connection/authentication";
    client = dependencies.client(url.toString());
    const started = Date.now();
    try {
      await client.$connect();
      report.prismaConnect = true;
      report.authentication = true;
    } catch (error) {
      report.prismaConnect = false;
      if (databaseFailureKind(error) === "AUTHENTICATION_FAILED") report.authentication = false;
      throw error;
    } finally { report.prismaConnectMs = Date.now() - started; }

    stage = "read-only SELECT/identity";
    report.select = false;
    await client.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const rows = await tx.$queryRaw<Array<{ value: number; database: string; schema: string; readonly: string }>>`
        SELECT 1::int AS value, current_database()::text AS database,
          current_schema()::text AS schema, current_setting('transaction_read_only') AS readonly
      `;
      report.select = rows.length === 1 && rows[0].value === 1;
      report.identity = rows.length === 1 && rows[0].database === "neondb" && rows[0].schema === "public";
      if (!report.identity) throw new PayoutPreflightError("DATABASE_IDENTITY_MISMATCH", "database identity", "Expected neondb/public.");
      if (rows[0].readonly !== "on") throw new PayoutPreflightError("READ_ONLY_CHECK_FAILED", "read-only guard", "Read-only mode was not confirmed.");
      if (!report.select) throw new Error("SELECT check failed");
    }, { maxWait: 10_000, timeout: 15_000 });
    stage = "full read-only preflight";
    report.preflight = false;
    await dependencies.preflight(client);
    report.preflight = true;
    // A broken address is visible, but an alternate verified TLS path may succeed.
    report.ok = report.network.some((probe) => probe.tls === true);
    if (!report.ok) report.failure = { category: "TLS_PROBE_FAILED", stage: "TCP/TLS", reason: "NO_VERIFIED_TLS_PATH" };
  } catch (error) {
    report.failure = error instanceof PayoutPreflightError
      ? { category: error.code, stage: error.stage, reason: "PREFLIGHT_REJECTED" }
      : { category: "DIAGNOSTIC_FAILED", stage, reason: databaseFailureKind(error) };
  } finally {
    if (client) {
      try { await client.$disconnect(); report.disconnect = true; }
      catch {
        report.disconnect = false;
        report.ok = false;
        report.failure ??= { category: "DIAGNOSTIC_FAILED", stage: "disconnect", reason: "DISCONNECT_FAILED" };
      }
    }
  }
  return report;
}
