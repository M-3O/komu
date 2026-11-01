# Operator-only Neon connectivity diagnostic

This command is separate from integration tests. It never creates fixtures,
starts the bot/dashboard, applies migrations, or changes database settings.
Do not run it until authorized to connect to the approved Neon TEST branch.
It can wake an idle test compute and authenticate using the supplied test URL.
No network diagnostic was executed during implementation.

## Exact PowerShell procedure

Use a fresh disposable PowerShell window. Paste only the verified direct TEST
connection string at the masked prompt, never into a command or source file.
The URL must select ep-purple-king-b5ojr6aq.c-7.us-east-2.aws.neon.tech,
database neondb, public schema, and sslmode=require.

~~~powershell
Set-Location 'C:\Users\PC\Desktop\komu'
$komuSecureUrl = Read-Host 'Verified Neon TEST direct PostgreSQL URL' -AsSecureString
try {
    $env:NODE_ENV = 'test'
    $env:KOMU_DATABASE_TARGET = 'neon-test'
    $env:KOMU_NEON_TEST_DATABASE_URL = [System.Net.NetworkCredential]::new('', $komuSecureUrl).Password
    Remove-Item Env:DATABASE_URL, Env:DEBUG, Env:RUST_LOG, Env:PRISMA_LOG_LEVEL -ErrorAction SilentlyContinue
    npm run diagnose:neon
    $komuDiagnosticExit = $LASTEXITCODE
    Write-Host "Diagnostic exit code: $komuDiagnosticExit"
} finally {
    Remove-Item Env:KOMU_NEON_TEST_DATABASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:KOMU_DATABASE_TARGET -ErrorAction SilentlyContinue
    Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
    $komuSecureUrl.Dispose()
    Remove-Variable komuSecureUrl
}
~~~

Close the shell afterwards. Changes above affect this shell and its children
only; no credentials or environment files are persisted. The plaintext URL
necessarily exists briefly in process memory/environment. Do not enable shell
tracing or dump environment variables.

For a separately authorized comparison, repeat the same procedure but replace
only the npm line with:

~~~powershell
npm run diagnose:neon -- --extended-timeouts
~~~

That option sets connect_timeout=15 and pool_timeout=15 on the diagnostic's
in-memory URL only. It never changes the endpoint, credentials, caller environment,
preflight transaction limits, or payout configuration. It performs one run, not
an automatic retry. A later success does not alone prove a timeout was the cause:
the first run may have warmed the compute or network conditions may have changed.

## What the result proves

Only booleans/null, counts, timings, fixed failure categories, and approved
target/database/schema identity are printed. No URL, IP address, account name,
password, certificate contents, migration logs, or raw errors are printed.
Null means not attempted or not established; it does not mean success.

- configuration: exact endpoint/database/schema/TLS guard passes before any DNS
  lookup, socket, or PrismaClient construction. DATABASE_URL is never a fallback.
- dns: OS lookup of the approved hostname; IPv4/IPv6 record counts are reported.
  DNS has a five-second diagnostic deadline.
- network: each of at most eight resolved addresses gets one TCP connection and
  PostgreSQL SSLRequest/TLS probe, bounded to five seconds total per address.
  The original hostname is retained for SNI and certificate verification.
  No username, password, or PostgreSQL startup/authentication packet is sent by
  these probes. Failed addresses remain visible even if another address works.
- prismaConnect/authentication: one explicit native Prisma $connect call.
  Successful connection proves authentication; a recognized authentication error
  sets authentication=false. Reachability/TLS/timeouts leave authentication=null.
  Prisma uses its own DNS/TLS stack and may choose another resolved address.
- select/identity: SELECT 1 and neondb/public identity inside a transaction whose
  first statement is SET TRANSACTION READ ONLY. Identity values returned by a
  mismatched server are never printed.
- preflight: the complete existing read-only migration/checksum/column/index
  preflight must also pass. This does not authorize or invoke integration tests.
- disconnect: Prisma is closed in finally. A 90-second process watchdog bounds
  native connection/DNS/shutdown stalls. No automatic transaction replay occurs.

The diagnostic always adds sslaccept=strict to its in-memory Prisma URL, verifies
certificates, and requires sslmode=require. This is deliberately stronger than
an existing URL that requests encryption alone. It does not silently change
application configuration. Node's TLS probe and Prisma's native TLS can use
different trust stores, so their results need not match.

Exit 0 requires successful Prisma/SELECT/identity/preflight, clean disconnect,
and at least one successful certificate-verified TLS probe. Exit 1 means a failed
or incomplete check; inspect the safe failure stage/reason. No fixture writes
exist in this command, regardless of result.

## Findings and minimal next steps

The observed failed IPv6 attempt plus a successful TCP attempt proves partial
TCP reachability at that moment. It does not establish TLS, authentication,
compute readiness, or successful PostgreSQL queries, nor prove IPv6 caused P1001.

Prisma 6.19.3 uses a native Rust connector in this project, not node-postgres.
The installed engine revision is c2990dca591cba766e3b7ef5d9e8a84796e47ab7.
Its [connector](https://github.com/prisma/prisma-engines/blob/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/quaint/src/connector/postgres/native/mod.rs)
wraps connection establishment in an overall connect_timeout. Its pinned
[PostgreSQL driver](https://github.com/prisma/rust-postgres/blob/278641fa1a08b7e7d35841342ab4426c5b063d9a/tokio-postgres/src/connect.rs)
resolves the hostname and tries addresses in sequence. A slow address can consume
the overall deadline before a later usable address succeeds. Node's
--dns-result-order=ipv4first affects Node lookups; it is not a reliable fix for the
native engine's resolver. Do not replace the approved hostname with a fixed IP:
Neon routing, TLS/SNI, address changes, and the exact-host guard depend on it.

The [native URL parser](https://github.com/prisma/prisma-engines/blob/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/quaint/src/connector/postgres/url.rs)
defaults connect_timeout to 5 seconds and pool_timeout to 10 seconds. The payout
preflight's maxWait=10,000 ms is the interactive transaction acquisition limit,
not the low-level DNS/TCP/TLS/authentication timeout. Its timeout=15,000 ms applies
to the running transaction. A failure before the callback starts remains labelled
transaction start; it cannot by itself distinguish network failure from waiting
for a pool connection. The safe reason now distinguishes P1001 UNREACHABLE,
P1002 CONNECTION_TIMEOUT, P1011 TLS_FAILED, P1000 AUTHENTICATION_FAILED, and
P2024 POOL_ACQUISITION_TIMEOUT without exposing the driver's message.

[Prisma's Neon guidance](https://www.prisma.io/docs/orm/v6/overview/databases/neon)
documents idle-compute wake-up and recommends bounded increases to connection
and pool timeouts when needed. Cold starts are a plausible cause here, not a
verified diagnosis. This diagnostic's authenticated checks can warm the compute;
the separate raw TCP/TLS probes do not prove the compute was already ready.

Recommended order:

1. Run the baseline diagnostic once; review family-specific TCP/TLS and the
   native Prisma failure reason. Keep only its sanitized JSON output.
2. If IPv6 consistently fails while IPv4 works, investigate Windows routing,
   VPN/firewall, DNS, or ISP IPv6 reachability. Compare on an approved alternate
   network. Avoid global IPv6 changes or an unverified endpoint replacement.
3. If connection timeouts remain, perform one explicit extended-timeout run.
   If warranted, use bounded connect_timeout=15 and pool_timeout=15 in the selected
   test session, then obtain separate review before changing production settings.
   Do not use zero/unlimited timeouts.
4. If TCP works but TLS fails, review SNI/certificate trust and TLS interception.
   Prisma's supported combination is sslmode=require with sslaccept=strict.
   Its parser does not support verify-full and falls back to prefer; the guard
   now rejects that mode rather than permitting an implicit TLS downgrade.
5. If authentication fails, check the approved branch's access locally; never
   paste credentials into logs/chat. If pool acquisition fails, check connection
   capacity and simultaneous services; the payout concurrency suite needs at
   least three connections across its payout and observer clients.
6. After connectivity and full preflight are understood, separately authorize
   the payout tests using [their secure procedure](./payout-postgres-testing.md).
   Do not raise the payout transaction execution timeout or blindly replay
   transactions as a connectivity workaround. Atomic XP/marker locking is unchanged.
