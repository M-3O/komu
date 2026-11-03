# Production P1001: one explicit read-only diagnostic

No production connection or diagnostic was run during implementation. This
command is for an authorized operator only. It never applies migrations, resolves
history, starts the bot/dashboard, creates fixtures, or changes database settings.
Its result always includes migrationApproved=false.

## Known facts and likely causes

SQL Editor success uses Neon's service-side path; it does not establish that the
Windows native Prisma path is healthy. A successful Test-NetConnection proves a
TCP connection at that moment, not TLS/SNI, authentication, or a SQL round trip.

The strongest remaining candidates are local DNS/address-family routing,
VPN/firewall/antivirus filtering, the direct endpoint/compute path, or differences
between the native Client and schema-engine executables. Twenty-second connection
timeouts failing repeatedly makes another blind timeout increase unhelpful.
Compute wake-up remains possible, but is not a demonstrated explanation.

The installed Prisma 6.19.3 native connector uses a Rust PostgreSQL driver that
tries resolved addresses sequentially. Its overall connection deadline can expire
before a later usable address is tried. Node's DNS-order setting does not control
that native resolver. Keep the approved hostname for TLS/SNI; replacing it with
an IP or changing to a pooler would change the diagnostic and bypass the intended
target guard.

P1001 means unreachable; bad credentials normally produce P1000, TLS failures
P1011, and malformed connection arguments a configuration error. A P1001 alone
does not prove which layer failed. The diagnostic preserves those distinctions
without parsing or printing raw error messages from the Client.

PowerShell URI rebuilding is a separate plausible configuration problem:

- Escaping already escaped userinfo can turn %40 into %2540 and change the password.
- Form-url-encoding the whole query can turn parameter separators into one key.
- Rebuilding can duplicate schema, sslmode, or timeout parameters.
- Copying decoded credentials back into a URL without escaping reserved characters
  can change its host, fragment, or credential boundaries.

Re-paste the original Prisma connection string from the independently selected
production branch at the masked prompt. Do not rebuild it with UriBuilder or
decode/repair its password. The diagnostic validates the URI but passes the
original text to both engines. If sslaccept is absent it appends only the literal
&sslaccept=strict, preserving all original credential/query encoding. A possible
double-encoding flag is only a clue: a real password can legitimately contain
text such as %40. It is never automatically decoded or corrected.

## One operator command

Use a fresh disposable PowerShell window in the repository containing these local
diagnostic changes. No .env file is read by the diagnostic itself. Inherited
DATABASE_URL is explicitly ignored; the dedicated input is mandatory. Existing
test-target variables cause rejection before DNS or connection attempts.

~~~powershell
Set-Location 'C:\Users\PC\Desktop\komu'
$komuProductionUrl = Read-Host 'Original Neon PRODUCTION direct Prisma URL' -AsSecureString
try {
    $env:NODE_ENV = 'production'
    $env:KOMU_EXPECTED_PRODUCTION_HOST = 'ep-misty-hat-b5hmnp08.c-7.us-east-2.aws.neon.tech'
    $env:KOMU_PRODUCTION_DIAGNOSTIC_DATABASE_URL = [System.Net.NetworkCredential]::new('', $komuProductionUrl).Password
    Remove-Item Env:KOMU_DATABASE_TARGET, Env:KOMU_NEON_TEST_DATABASE_URL, Env:DEBUG, Env:RUST_LOG, Env:PRISMA_LOG_LEVEL -ErrorAction SilentlyContinue
    npm run diagnose:neon -- --production --cli-status
    Write-Host "Diagnostic exit code: $LASTEXITCODE"
} finally {
    Remove-Item Env:KOMU_PRODUCTION_DIAGNOSTIC_DATABASE_URL, Env:KOMU_EXPECTED_PRODUCTION_HOST, Env:NODE_ENV -ErrorAction SilentlyContinue
    $komuProductionUrl.Dispose()
    Remove-Variable komuProductionUrl
}
~~~

Close the disposable shell afterwards. No credentials are persisted or passed
as command-line arguments. Do not enable shell tracing or print environment
variables. Share only the diagnostic's sanitized JSON.

The URI must have the exact confirmed direct production hostname, neondb/public,
sslmode=require, and no unknown/duplicate/redirection parameters. sslaccept, when
present, must be strict. The test hostname, pooler hostname, host/service overrides,
and sslmode=verify-full are rejected. Prisma 6's native parser does not implement
verify-full; strict certificate verification uses require plus sslaccept=strict.
The expected hostname must be independently confirmed in Neon Console as
production, not merely copied from an untrusted connection string.

The default diagnostic command still targets TEST and retains its full payout
preflight. The explicit production command checks connectivity and database/schema
identity only: an unapplied announcement migration is expected and must not be
confused with a connectivity failure. The TEST migration preflight is unchanged.

## Interpret once, then choose the next action

| Evidence | Next action |
| --- | --- |
| configuration=false | Correct the dedicated input/mode/identity or malformed query. No DNS/client/CLI should have run. |
| dns=false | Investigate Windows DNS first; native connection stages are not attempted. |
| IPv4 TLS works, IPv6 TCP/TLS fails | Routing/address-family filtering is plausible; native Prisma can still choose differently. Test once on an approved alternate network/clean Linux host rather than disabling IPv6 globally. |
| TCP works, verified TLS fails | Review TLS interception, CA trust, and SNI. Node and native Windows TLS can have different trust stores. |
| authentication=false / AUTHENTICATION_FAILED | Review the original branch/role credentials and URI encoding locally. Never paste credentials into logs/chat. |
| Prisma Client SELECT succeeds, CLI reports engine-error | Focus on the schema-engine/config/endpoint path rather than assuming a general database outage. |
| Both native paths report UNREACHABLE while verified TLS works | Try the same pinned, original URL once from a trusted Linux release host; review local security/network filtering and engine differences. |
| identity=false | Stop. The session did not confirm neondb/public; the CLI comparison is suppressed. |
| CLI state pending-review | Only a sanitized pending-state hint. Confirm exact pending migration/history in a separately reviewed status check before any DDL. |
| CLI state history-error, timeout, launch-failed, or unrecognized | Stop; no migration permission is implied by successful Client connectivity. |

The command resolves/probes addresses once (up to eight), authenticates one Prisma
Client, executes one read-only SELECT/identity transaction, and disconnects.
--cli-status explicitly adds one schema-engine status invocation on the same
validated URI; it can still run when the Client connection failed, for comparison.
The CLI output is captured, bounded, and summarized without raw errors. This is
not a general Prisma CLI pass-through: its only arguments are migrate status.
Missing executables, unknown output, and errors are not accepted as migration
approval. Timeouts are preserved from the pasted URL; --extended-timeouts is
deliberately rejected in production mode.

The Client SELECT transaction uses maxWait=10 seconds and timeout=15 seconds;
the separate CLI comparison has a 40-second limit and the command has a 90-second
process watchdog. There are no automatic transaction retries. The diagnostic
does not attempt to infer a Neon branch ID from neondb/public; endpoint pinning
plus the independent Console confirmation provides the branch selection.

## Alternative execution path, only after diagnostics and approval

If a clean trusted Linux host succeeds where Windows fails, prefer a one-off
controlled release job using the same reviewed source/lockfile and independently
verified direct production endpoint. Keep this separate from the secret-free
pull-request CI workflow; do not add production credentials to PR jobs.

Before any apply operation, verify the migration checksum:
a64e08838c0b44206f0c7a42ec07d573f1e9db06132a7509b05accf839c6c970.
Re-run the production identity/history checks from the reviewed runbook and
confirm exactly 20261029120000_challenge_completion_announcements is pending.
The failed Windows P1001 and absent/unchanged schema do not justify inserting an
applied record or using migrate resolve as a connectivity workaround.

After separate execution approval and the maintenance/backup checks, the existing
npm run db:deploy is the migration command on that release host. No apply command
is invoked by this diagnostic. Keep the already tested migration SQL unchanged.
Do not split SQL application and Prisma history marking merely to bypass the
failing Windows engine without a separately reviewed recovery plan.

After an approved migration, verify status is up to date, one effective successful
record has the reviewed checksum with no unresolved attempt, all four nullable
columns have the correct types/timestamp precision, and the three-column index is
ready and valid. Only then resume the approved application rollout.

## Primary references

- [Pinned native PostgreSQL driver](https://github.com/prisma/rust-postgres/blob/278641fa1a08b7e7d35841342ab4426c5b063d9a/tokio-postgres/src/connect.rs)
- [Prisma native URL parser](https://github.com/prisma/prisma-engines/blob/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/quaint/src/connector/postgres/url.rs)
- [Prisma v6 error codes](https://www.prisma.io/docs/orm/v6/reference/error-reference)
- [Neon connection errors](https://github.com/neondatabase/website/blob/main/content/docs/connect/connection-errors.md)

## Local changes and verification

- scripts/diagnose-neon.ts: explicit production and optional status flags.
- src/test/neon-connectivity-diagnostic.ts: hostname-aware shared probes and a
  production connectivity entrypoint; default TEST payout preflight retained.
- src/test/neon-connectivity-diagnostic.test.ts: production pinning/encoding/SNI regressions.
- src/test/production-neon-target.ts: dedicated fail-closed production URI validation.
- src/test/prisma-status-diagnostic.ts: bounded status-only CLI and safe summary.
- src/test/prisma-status-diagnostic.test.ts: no-write command, redaction, and deadline tests.
- docs/production-neon-connectivity.md: this operator procedure.

Offline verification: 756 unit tests passed, typecheck passed, lint passed.
No integration test, production connection, or diagnostic command was executed.
Migration SQL, schema, package versions, and credentials on disk are unchanged.
