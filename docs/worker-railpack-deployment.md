# Worker-only Railpack deployment candidate

Status: LOCAL CANDIDATE, NOT PRODUCTION-READY. No CranL action or Git mutation has
been performed. This work belongs only to deploy/komu-bot in
C:\Users\PC\Desktop\komu-bot-release, starting at be1e62f. Do not merge the root
railpack.json into dashboard main or copy it to the main development worktree.

## What is configured

railpack.json uses the official https://schema.railpack.com schema:

- provider=node and packages.node=24.
- Build/runtime OpenSSL and CA packages for Prisma native engine and HTTPS.
- An explicit local manifest input preserves package.json/package-lock.json when
  replacing provider install commands. Install runs npm ci with dev dependencies
  and skips only automatic Prisma Client generation during installation.
- Build commands replace (not append to) the provider commands. They run the
  existing npm run build:bot and then prune dev dependencies without scripts.
  npm run build and next build are not retained.
- Install/build/prune have empty secret mount lists; no build credentials are
  supplied. Source exclusions omit env files, credential/key files and local
  caches/verification artifacts.
- Default runtime tool/dependency/source layers are preserved with the official
  ... extension syntax. An extra build-layer node_modules/.prisma input retains
  the generated client/native engine even if the provider uses a separate prune
  layer made from install output. tsx remains a production dependency.
- Runtime uses exec node --import tsx src/bot/bootstrap.ts. Railpack's published
  image conversion uses /bin/bash -c; exec replaces that shell and preserves
  direct signal delivery to the Node process.
- Runtime defaults are NODE_ENV=production and PORT=3001. Runtime DATABASE_URL
  and credentials are intentionally absent from the configuration.

This is based on the official config schema/docs and inspected Node provider
source, not invented Railpack environment flags:
https://railpack.com/config/file/
https://github.com/railwayapp/railpack/blob/main/core/providers/node/node.go
https://github.com/railwayapp/railpack/blob/main/buildkit/convert.go

## Database isolation and unchanged business logic

The existing deploy/bot/prisma-generate.config.ts sets its own non-secret loopback
placeholder inside the generation CLI process and loads no dotenv or runtime
selector. Prisma confirms environment-file loading is skipped. That config is
used only by build:bot. The generated client references runtime DATABASE_URL,
not an embedded build URL. The parent process, default prisma.config.ts and bot
bootstrap validation are unchanged. Never use the generation-only config for
migration/database commands. No database command or migration is part of this
candidate. Source credentials must not be passed as build arguments or secrets.

Runtime still requires the application's actual production DATABASE_URL. Missing
or invalid values fail before Prisma-dependent bot imports. Do not replace that
runtime value with any build placeholder. No production or test URL is included
in this runbook, configuration or CI plan verifier.

XP payouts, challenge progression/announcement idempotency and Phase 1B lifecycle
code are not changed by this candidate.

## Root Docker fallback is inactive and reversible

railpack.json is the only active root-level worker builder configuration. The
root Docker files were reversibly renamed without changing their bytes:

- Dockerfile -> Dockerfile.worker.fallback
- Dockerfile.dockerignore -> Dockerfile.worker.fallback.dockerignore

The nested deploy/bot/Dockerfile and deploy/bot/Dockerfile.dockerignore remain
unchanged. No Docker file was deleted. The root fallback no longer occupies the
conventional Dockerfile auto-detection path. CI and unit tests reject an active
root Dockerfile and require both fallback pairs to remain available.

For an explicitly approved Docker fallback build, use either existing nested
Dockerfile or specify --file Dockerfile.worker.fallback. The renamed companion
Dockerfile.worker.fallback.dockerignore matches that explicit filename. Do not
rename either root file back while validating Railpack: doing so reintroduces
builder-selection ambiguity. Restoring the old names is reversible and requires
separate review before a future source publication/deployment.

CranL documentation describes Railpack and Dockerfile build types:
https://docs.cranl.com/platform/applications.html

Removing the conventional root Dockerfile resolves the repository-level
ambiguity; it does not prove this existing application's builder settings.
CranL's installed Railpack version, configuration support and injected command
or Dockerfile-path overrides remain UNVERIFIED. No app settings or secrets were
accessed or changed. Before any deployment, confirm the existing worker uses
Railpack, accepts this configuration and has no stale build/start overrides.
If it explicitly expects a root Dockerfile, STOP rather than changing it here.
Agent Protection stays enabled. A dashboard build in a worker plan is a failure.

## Runtime and health requirements

Preserve these in the EXISTING komu-bot application only (do not export values):

| Setting | Requirement |
| --- | --- |
| Repository/branch | M-3O/komu, deploy/komu-bot, reviewed commit |
| Builder | Verified Railpack selection; unresolved until confirmed |
| Build | Generated plan runs npm run build:bot, never Next.js build |
| Start | exec node --import tsx src/bot/bootstrap.ts |
| Node | 24 |
| Application port | 3001, matching PORT and binding on 0.0.0.0 |
| Public readiness | GET/HEAD /health; existing response contract |
| Protected snapshot | GET/HEAD /internal/health |
| Runtime environment | NODE_ENV=production, actual DATABASE_URL, existing Discord credentials |
| Test selection | KOMU_DATABASE_TARGET and KOMU_NEON_TEST_DATABASE_URL unset |
| Monitoring | Dedicated BOT_MONITORING_SECRET, runtime-only |

BOT_MONITORING_SECRET must be a high-entropy random value of 32-256 printable ASCII
characters without spaces. Send it only as x-komu-monitoring-secret over a
verified encrypted route. Never put it in URLs, source, browser code, logs or a
NEXT_PUBLIC_ variable. Missing configuration disables only the protected endpoint
with generic 503; wrong authentication returns 401. Public /health is unchanged.

The public endpoint reflects gateway readiness, not database availability. It
returns 503 during startup/reconnection and shutdown. The 90-second detailed
health grace does not make a disconnected bot return 200. Confirm platform probe
startup tolerance to avoid a restart loop. Quiet Discord servers remain normal.

Phase 1B stops admitting events, drains for at most 15 seconds and exits within
20 seconds on signals. Fatal failures use a five-second budget. Confirm at least
a 25-second provider termination allowance and real signal forwarding. Node exec
packaging cannot prove how CranL's own supervisor wraps/terminates the process.
Run only one active gateway worker per token; rolling overlap is unverified.

## Verification without deployment

Local safe commands from this worktree:

~~~powershell
npm run build:bot
npm test -- --pool=threads --maxWorkers=1
npm run typecheck
npm run lint
~~~

Use only disposable non-secret verification environment values where required;
never load production/test credentials to run these checks. The build needs no
DB environment. Do not run npm run bot, the bot bootstrap, registration commands
or database integration suites for this verification.

When Railpack is installed on a clean Linux machine:

~~~sh
railpack prepare --config-file railpack.json --plan-out /tmp/komu-bot-plan.json .
node scripts/verify-worker-railpack-plan.cjs /tmp/komu-bot-plan.json
~~~

The verifier rejects dashboard builds, missing Prisma generation/native engine
layer, unsafe install/start commands, build secret mounts, baked credential
variables, wrong runtime defaults and missing source layers. It prints only
fixed errors, never a raw plan or environment values. A valid plan is necessary
but not sufficient for a working Linux image.

The existing Linux Build verification workflow now conditionally installs
Railpack v0.43.0 with a pinned official archive SHA-256, prepares/verifies its
plan and builds through the matching official BuildKit frontend. Offline image
checks assert Node 24, resolvable tsx and Prisma Client, native engine loading,
no baked credential environment or root env files, and direct-Node module
imports without calling the bot entrypoint. No image is
pushed and no database/gateway is contacted.

The locally available origin/main workflow includes workflow_dispatch and
origin/HEAD points to main. GitHub requires the workflow to exist on the default
branch; selecting another ref runs that branch's workflow and checkout. The
worker branch also includes workflow_dispatch, and its Railpack steps run when
railpack.json exists. No push/PR branch filter excludes a manual dispatch.
Remote Actions enablement and the published worker revision were not queried.

After separate publication and CI approval, choose Build verification in GitHub
Actions, Run workflow, Use workflow from deploy/komu-bot. The equivalent command
below triggers CI; it is documentation only and has NOT been run:

~~~powershell
gh workflow run build.yml --repo M-3O/komu --ref deploy/komu-bot
~~~

GitHub's manual-run requirements:
https://docs.github.com/actions/managing-workflow-runs/manually-running-a-workflow

 Do not push or switch a CranL-linked branch just to obtain CI without
reviewing auto-deploy behavior: that push itself may trigger a rebuild. Existing
push triggers do not include deploy/**. No CI run was triggered by this task.
Docker/Railpack are unavailable locally, so Linux image execution remains
pending; schema and unit success do not substitute for those checks.

## Deployment sequence requiring future approval (instructions only)

1. Keep the candidate uncommitted until human review. Confirm all work remains
   in this worker worktree. Preserve Docker fallbacks and dashboard main.
2. Confirm the root Docker fallback remains inactive, then verify the actual
   app builder, Railpack version and command overrides. Do not switch the
   existing app's source or restore root Dockerfile names yet. Any platform
   change requires separate approval; Agent Protection stays enabled.
3. Obtain approval for publishing the reviewed worker commit and running Linux
   CI. Confirm that publishing to deploy/komu-bot will not trigger an unapproved
   app rebuild. Complete all plan/image checks before authorizing deployment.
4. Record the actual existing worker app ID, current source/build/start/port and
   health settings, last known-good deployment/image and atomic-payout-capable
   source commit. Record secret names/presence only, never their values.
5. After explicit deployment approval, use the confirmed update_app_source
   capability on ONLY that verified existing worker app to select
   deploy/komu-bot and the reviewed commit. Do not create/delete an application,
   alter komu/main, edit credentials or perform migrations. Exact API arguments
   must match the installed CranL operation schema; none are guessed here.
   Saving a source change may immediately deploy; it is not a harmless dry run.
6. Confirm the actual builder and command sequence in that approved build. Stop
   if it runs Next.js, ignores the config, mounts DB secrets or lacks the native
   engine. During approved replacement, ensure no simultaneous gateway workers.
7. Verify public readiness and authorized protected health with no automatic
   announcements or DB test writes. Observe lifecycle/reconnection and rollout
   results. Do not treat a green gateway check as proof of database health.

## Automatic rollback and recovery

CranL advertises deployment health/rollback capabilities, but the exact failure
trigger, window, old-instance retention and restart behavior for this app are
UNVERIFIED. Build/preflight failure, startup failure, missing monitoring secret,
or an operational DB failure need not all trigger the same automatic rollback.
A green gateway /health cannot detect all DB/job failures. Check the actual
reported deployment status; never infer that the old worker is still active.

If a release fails, preserve its sanitized build/runtime failure and exit/status
information. Use the existing app's recorded last known-good deployment/image
when that restore operation is explicitly authorized. If a source revert is
needed, restore its recorded source/build/start settings, not an arbitrary main
commit whose defaults run the dashboard. A rollback source update can trigger
another rebuild and needs the same approval and builder checks.

Keep one active bot, preserve runtime credentials and all DB state, and retain
atomic payout/announcement safeguards. Do not migrate/reset/delete data or replay
announcements. Do not fall back to a test database or disable validation/Agent
Protection. If the previous image cannot be restored, prepare a reviewed worker
source release with known-good packaging and repeat Linux verification. The
komu dashboard and main branch remain untouched throughout.
