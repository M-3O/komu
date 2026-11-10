# TikTok PostgreSQL integration testing

**Status: prepared, not executed.** This suite is for a disposable local
PostgreSQL database only. It does not load `.env` files, does not use the
application `DATABASE_URL`, and does not call TikTok.

## Guarded command

The operator must create an empty local database named
`komu_tiktok_disposable`, review the target, and explicitly approve the run in
the shell. The suite refuses Production, Neon TEST, cloud hosts, non-loopback
hosts, inherited `DATABASE_URL`, and inherited real `AUTH_SECRET` values.

PowerShell example using a local role that does not require a password:

```powershell
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:KOMU_NEON_TEST_DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:KOMU_PRODUCTION_DATABASE_URL -ErrorAction SilentlyContinue
$env:KOMU_DATABASE_TARGET = "local-disposable"
$env:KOMU_TIKTOK_DB_APPROVED = "1"
$env:KOMU_TIKTOK_DATABASE_URL = "postgresql://komu_test@127.0.0.1:5432/komu_tiktok_disposable?schema=public&sslmode=disable"
npm run test:tiktok:postgres
```

The test setup validates all of those values before assigning the selected URL
to Prisma's `DATABASE_URL`. Running the command without the approval marker or
with any inherited application URL fails before Prisma is constructed. This
document does not authorize a migration or a database execution.

## Prepared coverage

`src/lib/tiktok/database.postgres.integration.test.ts` uses synthetic users,
guilds, tokens, and provider responses. It covers:

- concurrent OAuth state consumption, replay, expiry, and identity mismatch;
- distributed refresh/disconnect lease single-flight, stale-lease crash
  recovery, and credential-version compare-and-swap protection;
- one active connection per guild, safe relinking, transaction rollback, and
  the guild uniqueness constraint;
- AES-GCM authentication, provider key separation, and Discord legacy/encrypted
  token compatibility;
- failed revocation, bounded pending retention cleanup, authenticated
  revocation retry leasing, and confirmed disconnect credential deletion.
- destructive deletion is blocked by `RESTRICT` foreign keys while a queued
  revocation exists, so pending encrypted credentials cannot be cascaded away.

No test imports or invokes an unofficial TikTok package, scraping code, or the
TikTok network API. `npm test` excludes this file because it ends in
`.integration.test.ts`.

## Review decisions still required

- The migration must be applied only to the named disposable local database
  after the database owner approves its additive shape. It has no `ALTER TABLE`
  or enum operation against existing business tables.
- The seven-day revocation window is a maximum-retention policy, not a
  background guarantee yet. `purgeExpiredTikTokRevocationCredentials` deletes
  only rows in `tiktok_revocations`; it cannot delete a newer guild link.
  `runTikTokRevocationMaintenance` is exposed through the prepared,
  separately-authenticated POST endpoint, but scheduling and completion
  alerting require approval before production linking.
- TikTok ciphertext `tiktok:v1` derives its AES-256-GCM key from `AUTH_SECRET`
  with a TikTok-specific HKDF info string. Changing `AUTH_SECRET` currently
  invalidates both Discord and TikTok stored credentials. A production key
  rotation needs an approved dual-key/re-encryption run or an explicit
  reauthorization plan; it must not be improvised during deployment.
- Login Kit/Display API approval, the exact redirect URI, and the approved
  `user.info.basic` scope are required before the hard-disabled feature gate
  can be reconsidered. `video.list` remains optional and TikTok LIVE remains
  unavailable.
