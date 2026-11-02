# Atomic challenge payout PostgreSQL tests

Run only after reviewing the local changes and authorizing fixture writes.
The dedicated runner runs exactly four payout tests, never the other integration
suites. It does not load environment files, start services, contact Discord, or
apply migrations.

## Approved database

- Direct endpoint: ep-purple-king-b5ojr6aq.c-7.us-east-2.aws.neon.tech
- Database: neondb
- Schema: public

The pooler hostname is deliberately not accepted. Copy the connection string from
this branch's direct connection settings, with sslmode=require. For certificate
verification use sslaccept=strict; Prisma 6's native connector does not implement
sslmode=verify-full and falls back to prefer, so the test guard rejects it.
An omitted schema means public; an explicit schema must be public.
Do not copy connection strings into commands, files, screenshots, or chat.

In a fresh, disposable PowerShell window:

~~~powershell
Set-Location 'C:\Users\PC\Desktop\komu'
$komuSecureUrl = Read-Host 'Verified Neon TEST direct PostgreSQL URL' -AsSecureString
try {
    $env:NODE_ENV = 'test'
    $env:KOMU_DATABASE_TARGET = 'neon-test'
    $env:KOMU_NEON_TEST_DATABASE_URL = [System.Net.NetworkCredential]::new('', $komuSecureUrl).Password
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    npm run test:payout:postgres
    if ($LASTEXITCODE -ne 0) { throw 'Payout PostgreSQL tests failed. Review results before release.' }
} finally {
    Remove-Item Env:KOMU_NEON_TEST_DATABASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:KOMU_DATABASE_TARGET -ErrorAction SilentlyContinue
    Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
    $komuSecureUrl.Dispose()
    Remove-Variable komuSecureUrl
}
~~~

Close that shell afterwards. The URL is briefly present in its process
environment, which Prisma requires; the secure prompt keeps it out of terminal
output and command history. Do not enable tracing or echo environment variables.
Do not use the broader test:integration script for this verification.

## Safety gates and expected results

Before constructing a client, the runner requires explicit neon-test mode and the
dedicated test URL. It rejects production mode, a conflicting DATABASE_URL,
alternate endpoints, databases, schemas, non-TLS settings, and connection options
that could redirect the connection. DATABASE_URL is never a fallback.

A read-only repeatable-read transaction checks database/schema identity, read-only
status, every local migration's SHA-256 and successful completion, required
column types/nullability, and required valid indexes. Missing or mismatched
effective applied records, unresolved attempts, ambiguous states, or unknown
migration names fail closed. This verifies the approved
URL and SQL database/schema, not a separately queried Neon branch ID.
No fixture is created or cleaned up unless all checks pass. If they fail, review
the branch/migration mismatch manually; this runner never applies a migration.

## Diagnosing a failed preflight

Repeat the secure PowerShell procedure above, whose exact runner command is:

~~~powershell
npm run test:payout:postgres
~~~

The error now includes a stable category and the check stage, followed by
"No fixture writes authorized." Share that sanitized error and test counts only.
No raw driver error, URL, credential, unexpected database name, or migration log
is included. Known local migration/column/index names can appear.

| Category | Meaning / next manual check |
| --- | --- |
| INVALID_TARGET_CONFIGURATION | Missing explicit selection, malformed URL/options, production mode, or conflicting inherited DATABASE_URL. |
| ENDPOINT_IDENTITY_MISMATCH | URL is not the approved direct endpoint, port, database, or schema. No connection attempted. |
| DATABASE_CONNECTIVITY_FAILURE | Recognized connection/authentication/TLS/acquisition error. Check branch availability and access locally without sharing credentials. |
| DATABASE_PERMISSION_DENIED | Recognized database or metadata permission denial. |
| DATABASE_TRANSACTION_FAILURE | Read-only transaction timeout, cancellation, deadlock, or serialization failure. |
| DATABASE_IDENTITY_MISMATCH | SQL identity did not confirm neondb/public. Unexpected values are not printed. |
| READ_ONLY_CHECK_FAILED | PostgreSQL did not confirm read-only mode. |
| LOCAL_MIGRATION_MANIFEST_FAILURE | Local migration files could not be read or the manifest is empty. |
| MIGRATION_HISTORY_MISSING | PostgreSQL reports that public._prisma_migrations is absent. |
| MIGRATION_MISSING / MIGRATION_INCOMPLETE | Required local migration has no history, no effective applied record, or an unresolved failed/in-progress attempt. |
| MIGRATION_HISTORY_UNEXPECTED | Multiple effective successes, contradictory finished/rolled-back state, or a migration name outside the local manifest. |
| MIGRATION_EXECUTION_UNVERIFIED | Effective applied record has an invalid (negative or non-integer) step count. Zero is valid for a resolved/baselined migration. |
| MIGRATION_CHECKSUM_MISMATCH | Exact bytes differ; a separate hint identifies an LF/CRLF-only difference. |
| REQUIRED_COLUMN_MISSING / REQUIRED_COLUMN_MISMATCH | Required column missing/not visible, or type/nullability differs. |
| REQUIRED_INDEX_MISSING_OR_INVALID | Required index missing or not valid. |
| METADATA_QUERY_FAILURE | Unrecognized query/driver failure at the reported stage; details deliberately suppressed. |

The former generic error does not establish which check failed. Possible causes
include a Neon wake-up/connection timeout, metadata permissions, different
database/schema, migration-history drift, checksum differences, or missing
columns/indexes. The URL pins the endpoint; SQL identity does not independently
return a Neon branch ID. Catalog identifiers are cast to text explicitly so the
queries do not depend on decoding PostgreSQL-specific identifier/domain types.

## Effective migration history policy

Installed Prisma/engines version: 6.19.3. The installed engines-version dependency
identifies revision c2990dca591cba766e3b7ef5d9e8a84796e47ab7. The review used that
revision's [apply logic](https://github.com/prisma/prisma-engines/blob/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/schema-engine/commands/src/commands/apply_migrations.rs),
[resolve-applied logic](https://github.com/prisma/prisma-engines/blob/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/schema-engine/commands/src/commands/mark_migration_applied.rs),
and [migration persistence](https://github.com/prisma/prisma-engines/blob/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/schema-engine/connectors/sql-schema-connector/src/sql_migration_persistence.rs).

For every local migration the preflight requires:

1. Exactly one effective applied record: finished_at is set and rolled_back_at is
   null, with the exact local checksum and a nonnegative integer step count.
2. Every other attempt is explicitly rolled back and unfinished. Its historical
   checksum may differ: it identifies abandoned SQL, not the effective migration.
3. No unresolved failed/in-progress attempts (both timestamps null), contradictory
   states (both timestamps set), or multiple effective applied records.
4. No database migration names outside the local manifest, even if rolled back.
5. All existing read-only, identity, required-column/type/nullability, and valid-index
   checks still pass before fixture writes are authorized.

This accepts a failed attempt resolved as rolled back followed by a successful
retry, or by resolve --applied. Prisma retains historical attempts; its applied
resolution path marks unfinished attempts rolled back and inserts a separate
finished record. Baselining/resolution can leave applied_steps_count at zero;
finished_at, the checksum, and required live schema checks remain mandatory.
The metadata cannot independently prove how a zero-step record was produced, and
the required-object checks are not a complete schema-drift audit.

Prisma compares checksums using alternate line endings. This runner continues
to require the exact byte checksum and reports line-ending-only differences
without accepting them. See [Prisma's checksum comparison](https://github.com/prisma/prisma-engines/blob/6.19.0/schema-engine/connectors/schema-connector/src/checksum.rs).

Multiple rows alone do not establish whether the actual branch is safe. To inspect
the reported migration, select the approved TEST branch explicitly in Neon SQL
Editor and run this read-only query. It does not retrieve migration logs:

~~~sql
BEGIN READ ONLY;
SELECT current_database()::text AS database, current_schema()::text AS schema;
SELECT migration_name, started_at, finished_at, rolled_back_at,
       applied_steps_count, checksum
FROM public._prisma_migrations
WHERE migration_name = '20261024150000_security_indexes_and_drop_admin_flag'
ORDER BY started_at, id;
ROLLBACK;
~~~

No database history was inspected during this code review. If the rows do not fit
the policy above, stop for review rather than selecting an arbitrary row or
discarding a failed attempt. After review, use the secure PowerShell procedure
above and its dedicated test:payout:postgres command; preflight will still decide
whether all checks pass before creating fixtures.

Do not edit migration files, mark migrations applied, or bypass a gate simply to
obtain a passing run. Review the reported category before any separately approved
remediation. The runner performs no automatic retries or database repairs.

Each test creates a new UUID guild, member, challenge, and completion. Cleanup
matches both the preassigned guild ID and its unique fixture Discord ID; foreign
key cascades remove only that guild's fixture children. It never resets or
truncates tables or uses existing members. An interrupted process or unreachable
database can leave identifiable payout-guild-UUID fixtures; investigate those
specific records manually rather than running broad cleanup.

The concurrency case requires two distinct, simultaneously open PostgreSQL
transactions and uses a third observer connection to prove a real lock wait.
The URL must permit at least two connections for the payout client; the
database/role needs capacity for at least three connections in total and access
to its own sessions in pg_stat_activity/pg_blocking_pids. A five-second bounded
rendezvous or lock-observation failure fails the test rather than accepting a
serialized run. Production payout transactions retain their 10-second acquisition
and 15-second execution limits. No external calls occur while those locks are held.

Expected: 4 tests pass. Both failure tests assert transaction-visible XP and
ledger state at the intended injection point, verify PostgreSQL division-by-zero
SQLSTATE 22012, then verify rollback and exactly one payout after retry/repeat.
The post-marker fault aborts a real transaction before commit; it does not simulate
a lost network acknowledgement after a successful COMMIT.

## Remaining release gates

1. Run the command above and retain the credential-free test summary.
2. Resolve any failures or timeout/capacity issues; do not bypass the preflight.
3. Complete unit tests, typecheck, lint, production build, and security review.
4. Plan the existing announcement migration's approved production rollout and
   verify production schema readiness separately. No new payout migration exists.
5. Deploy dashboard and the separately hosted standalone bot with matching
   production configuration; replace all old payout handlers before enabling
   concurrent traffic. Do not select neon-test in production.
6. Perform an approved production smoke test and monitor payouts, announcements,
   connection failures, and pending role grants. Discord role delivery remains
   best effort after commit; a crash at that boundary requires role reconciliation,
   never an XP replay.
