# Clean Linux build verification

The build.yml workflow uses a fresh ubuntu-24.04 runner and supported Node 24 LTS.
Node 24 meets the locked requirements for Next.js 16.4.3, Prisma 6.19.3,
Vitest 5.0.3, and tsx 4.23.15. The repository previously had no Node engine/version
pin; CI explicitly selects the Node 24 major so security/patch releases can advance.
The existing package scripts and dependency versions are unchanged by this task.

Checkout and setup-node use full commit SHAs verified against the official v6
tags. The workflow token has contents:read only; checkout does not persist its
credentials. There are no repository secrets, environments, deployment actions,
artifact uploads, database services, migrations, or command registration calls.
It uses pull_request, not pull_request_target.

The workflow runs, in order:

1. npm ci --include=dev --no-audit --no-fund
2. npx --no-install prisma generate
3. npm run typecheck
4. npm run lint
5. npm test with the explicit unit config, one worker
6. npm run build
7. npm run build:bot

The production builds also generate Prisma Client through their existing scripts.
That repetition is intentional: each deployment build remains self-contained.
Generation does not require a live database. The bot build currently generates
Prisma Client; the preceding typecheck covers the bot's TypeScript. It never runs
the gateway entrypoint.

Only non-secret compilation placeholders are supplied. The database URL targets
loopback port 9, with no PostgreSQL service present. No Neon URL is used and
neon-test selection variables are not set. The Discord token is deliberately
invalid. Optional third-party API secrets are not needed for compilation.
Polling is disabled. NODE_ENV=production applies only to build steps, so dev
dependencies are installed and unit tests retain their normal test environment.
The unit config explicitly excludes all *.integration.test.ts files.

The workflow has a 20-minute job limit. It runs on main and ci/** pushes, pull
requests targeting main, and manual dispatch. Manual dispatch becomes available
once the workflow is on the default branch. A feature-branch push can run it first.
No build output from this placeholder-configured check should be deployed; real
release artifacts need the intended public URL and an approved production build.

## Lockfile and local verification

package-lock.json is lockfile version 3. Its root dependency/devDependency ranges
match package.json, and all declared direct dependencies have satisfying locked
versions. The 576 locked package entries were checked for non-optional Node-engine
compatibility with the locally tested Node 24.21.0. No mismatch was found.
npm ci --dry-run --ignore-scripts --no-audit --no-fund passed without changing the
lockfile or replacing the existing node_modules tree.
An additional fresh installation in an isolated Windows directory containing
only copies of package.json and package-lock.json succeeded: 445 packages
installed. Lifecycle scripts were explicitly disabled for that isolated check,
so actual Linux install hooks, generation, and builds remain CI verification
steps. The locked Linux x64 SWC, Tailwind Oxide, and esbuild packages are present.
Local workflow YAML/command/permission checks, typecheck, lint, and all 730 unit
tests passed with no environment-related exclusions. The full unit suite also
passed with the workflow's exact placeholder environment. Installation warned
that ESLint 9.39.5 is no longer supported; review the lint-tool upgrade separately.

A clean Linux installation and production build are not yet proven: they require
the first GitHub Actions run after human review and push. The Windows production
build remains subject to the previously reported engine-file/junction restrictions.
Google Fonts downloads require HTTPS access to fonts.googleapis.com and
fonts.gstatic.com. If that fails on Actions, preserve the same font families and
weights; fix network/trust access or review licensed local WOFF2 assets rather
than silently changing the design or disabling TLS checks.

The prior full audit had 16 moderate development-tool findings through minimatch
and ESLint; the production-only audit was clean. CI does not run audit fix or alter
dependencies. Review the lint-tool upgrade/risk decision separately.

## Review and push manually

The pre-existing working tree contained 23 tracked modifications and 23 untracked
files. The inventory below records that set; this workflow and this document are
additional new files. In particular, the new bot bootstraps, shared database
selector, announcement sender, and announcement migration must not be omitted
while staging the tracked files that import/use them. The migration is included
as source only; CI never applies it. Keep tests, operator diagnostics, and their
support helpers with the changes for reproducibility.

First inspect the source and workflow locally:

~~~powershell
Set-Location 'C:\Users\PC\Desktop\komu'
git status --short
git diff --check
git diff
git ls-files --others --exclude-standard
Get-Content .github/workflows/build.yml
git check-ignore .env.local .env .env.production.local
~~~

Do not stage local env files, .next, node_modules, or verification artifacts.
The tracked .env.example is a placeholder template; .env.production contains
non-secret polling defaults. Avoid git add .; stage reviewed changes explicitly
or with git add -p, and include every required new file from the inventory.
Git diff does not show untracked file contents; review those files separately.

After human review, the following are operator commands, not commands executed by
the assistant. Use the feature branch to avoid pushing directly to production main:

~~~powershell
git switch -c ci/build-verification
git add -- .github/workflows/build.yml docs/ci-build-verification.md
git add -p
# Run this block only after reviewing every "New" inventory row for this release.
$komuReviewedNewFiles = Get-Content docs/ci-build-verification.md |
    Where-Object { $_ -match '^\| New \| [^|]+ \|' } |
    ForEach-Object { ($_ -split '\|')[2].Trim() }
git add -- $komuReviewedNewFiles
git diff --cached --check
git diff --cached --stat
git diff --cached
# Stop here if release-critical new files are still missing from the staged set.
git commit -m "Add clean Linux build verification"
git push -u origin ci/build-verification
~~~

Before executing the commit/push commands, ensure the reviewed source files are
included alongside the workflow; adding only these two files would test the old
committed application rather than the current working tree. Do not stage
unrelated changes merely to make the inventory empty.

Then open a pull request from ci/build-verification to main and inspect every
step in the Build verification / Linux / Node 24 check. Fork pull requests may
need maintainer approval before GitHub runs the workflow. Set the passing check
as a required branch-protection rule if appropriate. No GitHub run has been
created or inspected from this local session.

Check existing hosting auto-deploy settings before pushing/merging: this workflow
does not deploy, but the README describes apps connected to main, and independent
hosting integrations could react to repository events. Do not merge to main until
release and hosting approval are complete.

## Reviewed pre-existing release inventory

| State | Path | Purpose |
| --- | --- | --- |
| Modified | .env.example | Environment initialization, validation, or polling controls |
| Modified | README.md | Operator/release documentation |
| Modified | next.config.ts | Environment initialization, validation, or polling controls |
| Modified | package.json | Build/runtime integration or command documentation |
| Modified | prisma.config.ts | Environment initialization, validation, or polling controls |
| Modified | prisma/schema.prisma | Schema contract and existing announcement migration; never applied by CI |
| Modified | src/app/dashboard/alerts/page.tsx | Guild-scoped dashboard announcement UI/validation |
| Modified | src/app/dashboard/challenges/ChallengeManager.tsx | Guild-scoped dashboard announcement UI/validation |
| Modified | src/app/dashboard/challenges/actions.ts | Guild-scoped dashboard announcement UI/validation |
| Modified | src/app/dashboard/challenges/page.tsx | Guild-scoped dashboard announcement UI/validation |
| Modified | src/bot/commands/challenge.ts | Build/runtime integration or command documentation |
| Modified | src/bot/commands/commands.test.ts | Offline tests, transaction model, or operator-only preflight helper |
| Modified | src/bot/index.ts | Build/runtime integration or command documentation |
| Modified | src/bot/register-commands.ts | Build/runtime integration or command documentation |
| Modified | src/bot/services/progression.ts | Atomic challenge payouts and announcement delivery |
| Modified | src/instrumentation.ts | Environment initialization, validation, or polling controls |
| Modified | src/lib/attendance/record-attendance.test.ts | Offline tests, transaction model, or operator-only preflight helper |
| Modified | src/lib/challenges/grant-completion.ts | Atomic challenge payouts and announcement delivery |
| Modified | src/lib/db.ts | Environment initialization, validation, or polling controls |
| Modified | src/lib/discord/rest.ts | Build/runtime integration or command documentation |
| Modified | src/lib/xp/award-xp.ts | Atomic challenge payouts and announcement delivery |
| Modified | src/lib/xp/message-xp.test.ts | Offline tests, transaction model, or operator-only preflight helper |
| Modified | src/test/outbound-requests.test.ts | Offline tests, transaction model, or operator-only preflight helper |
| New | docs/local-neon-test.md | Operator/release documentation |
| New | docs/neon-connectivity.md | Operator/release documentation |
| New | docs/payout-postgres-testing.md | Operator/release documentation |
| New | prisma/migrations/20261029120000_challenge_completion_announcements/migration.sql | Schema contract and existing announcement migration; never applied by CI |
| New | scripts/diagnose-neon.ts | Operator-only connectivity command; never invoked by CI |
| New | src/app/dashboard/challenges/actions.test.ts | Offline tests, transaction model, or operator-only preflight helper |
| New | src/bot/bootstrap.test.ts | Offline tests, transaction model, or operator-only preflight helper |
| New | src/bot/bootstrap.ts | Environment initialization, validation, or polling controls |
| New | src/bot/register-bootstrap.ts | Environment initialization, validation, or polling controls |
| New | src/bot/services/progression.test.ts | Offline tests, transaction model, or operator-only preflight helper |
| New | src/lib/challenges/announce-completion.test.ts | Offline tests, transaction model, or operator-only preflight helper |
| New | src/lib/challenges/announce-completion.ts | Atomic challenge payouts and announcement delivery |
| New | src/lib/challenges/grant-completion.integration.test.ts | Manually gated PostgreSQL tests/config |
| New | src/lib/challenges/grant-completion.test.ts | Offline tests, transaction model, or operator-only preflight helper |
| New | src/lib/config/database-environment.test.ts | Offline tests, transaction model, or operator-only preflight helper |
| New | src/lib/config/database-environment.ts | Environment initialization, validation, or polling controls |
| New | src/lib/db.test.ts | Offline tests, transaction model, or operator-only preflight helper |
| New | src/test/neon-connectivity-diagnostic.test.ts | Offline tests, transaction model, or operator-only preflight helper |
| New | src/test/neon-connectivity-diagnostic.ts | Offline tests, transaction model, or operator-only preflight helper |
| New | src/test/payout-postgres-preflight.test.ts | Offline tests, transaction model, or operator-only preflight helper |
| New | src/test/payout-postgres-preflight.ts | Offline tests, transaction model, or operator-only preflight helper |
| New | src/test/transactional-payout-store.ts | Offline tests, transaction model, or operator-only preflight helper |
| New | vitest.payout.config.ts | Manually gated PostgreSQL tests/config |
