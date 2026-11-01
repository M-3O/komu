# Running the dashboard and bot against the Neon test branch

Stop existing local dashboard and bot processes first. Restart both after any
database environment change; hot reload deliberately refuses a cached Prisma
client whose selected URL has changed.

Run this block separately in each PowerShell window. Paste the **same verified
Neon test-branch connection string**, including its database name and schema
parameter, at the hidden prompt. The prompt avoids recording the URL in shell
history. Do not put it in a tracked file or share it in logs.

```powershell
Set-Location 'C:\Users\PC\Desktop\komu'
$env:NODE_ENV = 'development'
$komuSecureUrl = Read-Host 'Verified Neon test-branch PostgreSQL URL' -AsSecureString
$env:KOMU_NEON_TEST_DATABASE_URL = [System.Net.NetworkCredential]::new('', $komuSecureUrl).Password
$env:KOMU_DATABASE_TARGET = 'neon-test'
$env:DATABASE_URL = $env:KOMU_NEON_TEST_DATABASE_URL
$env:KOMU_DISABLE_STREAM_POLLING = '1'
Remove-Variable komuSecureUrl
```

In the dashboard window:

```powershell
npm run dev
```

In the bot window:

```powershell
npm run bot
```

Keep `NODE_ENV` unset or set to `development` for this local test; `neon-test`
is rejected in production. Use the package scripts so dotenv loads before the
standalone entry modules. Inherited Discord credentials keep precedence over
env-file values. Bot env paths are resolved from the repository rather than
the caller's current directory.

Both services print `[database] target=neon-test hostname=<Neon endpoint>` when
creating their Prisma client. The dashboard may print this only when a route
first imports the database module. Compare both hostnames with the endpoint
in Neon's test-branch connection dialog. This log includes no username,
password, URL, query parameters, or Discord token.

The selector validates URL syntax and the Neon hostname suffix. It cannot
infer a Neon branch's name or verify migration state without connecting.
Selecting a syntactically valid URL for the wrong Neon branch still points
at that branch: always obtain the URL from the verified test branch.

Explicit test selection replaces a stale `DATABASE_URL` once, then pins that
exact URL in Prisma's constructor. Missing/invalid test configuration, a test
URL without its target, unexpected changes after selection, and mismatched
cached clients fail instead of falling back. Neither changing environment
variables in a different PowerShell window nor editing env files updates an
already running bot.

The polling switch disables dashboard background stream timers for an isolated
test. It does not disable manually invoked polling API requests.

When returning this shell to normal development, stop its service and remove
the test variables; remove `DATABASE_URL` too so normal env-file loading can
resume in a fresh process:

```powershell
Remove-Item Env:KOMU_DATABASE_TARGET, Env:KOMU_NEON_TEST_DATABASE_URL, Env:KOMU_DISABLE_STREAM_POLLING, Env:DATABASE_URL -ErrorAction SilentlyContinue
```
