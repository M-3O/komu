> Worker deployment update: use [worker-railpack-deployment.md](worker-railpack-deployment.md). The root Docker files are now Dockerfile.worker.fallback and Dockerfile.worker.fallback.dockerignore; the nested deploy/bot Docker files are unchanged. The following historical Docker preparation instructions are retained for reference. Do not restore conventional root Dockerfile names or repeat source changes without review.

# Isolated worker build and CranL release procedure

Status: prepared locally, not deployed. No CranL settings were accessed/changed.
No database is required for the build. No migration is run by any new command.

## Cause and scope

Railpack detects the shared package.json and selects the dashboard build/start
scripts. The dashboard remains npm run build / npm run start. Do not change them,
add a root railpack.json/Procfile, or place the worker Dockerfile at repository
root on the shared dashboard branch.

npm run build:bot now selects deploy/bot/prisma-generate.config.ts. This CLI-only
configuration always sets a non-secret loopback/discard-port DATABASE_URL,
loads no dotenv or runtime database selector, and points to the existing schema.
Prisma reports that automatic environment-file loading is skipped. Its child
process cannot change the parent shell or running applications. It does not
need inherited Neon credentials and never connects to that placeholder database.

The default prisma.config.ts, runtime bootstrap/selector and production
validation are unchanged. Database CLI commands must continue using the default
config. Never use the generation-only config for migration or database commands.
The worker runtime image deliberately omits both generation configs and Prisma
CLI; it uses the generated client and actual injected runtime DATABASE_URL.
No build-time placeholder is stored as image ENV/ARG or written into env files.

## Container design

Build from repository root:

~~~sh
docker build --file deploy/bot/Dockerfile --tag komu-bot:review .
~~~

The image uses Node 24/bookworm-slim for both build and runtime, with OpenSSL and
CA certificates. Install includes dev dependencies for Prisma CLI. Client
postinstall generation is skipped only in that install command; explicit
generation follows with BuildKit networking disabled. Prisma native engine
installation remains enabled. Dev dependencies are pruned after generation.

The final stage retains production dependencies (including tsx), generated
Prisma Client/native engine, tsconfig paths and source modules. It runs as the
node user. Its exec-form CMD is node --import tsx src/bot/bootstrap.ts: Node is
PID 1 and directly receives SIGTERM. It retains Phase 1B admission/drain/fatal
handling. There is no npm/shell/tsx CLI wrapper, automatic bot registration,
migration, polling coordinator or background reconciliation.

PORT defaults to 3001; the application binds 0.0.0.0. No Docker HEALTHCHECK adds
another polling loop. Keep CranL's existing public /health check; never point
it at authenticated /internal/health. Gateway startup/reconnect returns 503,
including during the 90-second classification grace. Confirm platform startup
probe tolerance, restart policy and at least a 25-second termination allowance
before an approved release (the worker budget is 20 seconds).

The Dockerfile-specific deploy/bot/Dockerfile.dockerignore is an allowlist for
this build only. It excludes root/nested env files, npm credentials, keys, logs,
local node_modules/.next, Git metadata and tests. It does not change dashboard
Railpack filtering or its tracked non-secret .env.production defaults.

Docker documents per-Dockerfile ignore files:
https://docs.docker.com/build/concepts/context/#filename-and-location

## CranL capability: verified documentation versus unknown integration

Railpack itself supports RAILPACK_BUILD_CMD and RAILPACK_START_CMD, but requires
its integrator to forward build options explicitly. CranL forwarding was not
verified, so simply setting app environment variables is not a reliable fix.
https://railpack.com/config/environment-variables/

CranL documents a selected source branch, Railpack/Dockerfile build types, and
only a root file named Dockerfile. Custom Dockerfile paths/build-root overrides
were not verified:
https://docs.cranl.com/platform/applications.html

The Dockerfile requires a BuildKit-compatible builder for RUN --network=none.
CranL support for that instruction and its handling of Dockerfile-specific
ignore files must be confirmed by the reviewed worker build; neither has been
tested against the actual CranL app. Do not remove network isolation or add
production build credentials to work around an unsupported builder.

Therefore keep these files nested on the shared branch. The documented fallback
is a WORKER-ONLY source branch with root copies of the reviewed container files.
This requires a later approved source/configuration change; preparation here
has not created/pushed that branch or changed either app.

## Exact operator release configuration (after review and Linux checks)

1. Ensure the reviewed changes, including new files, are in an approved commit
   and the expanded GitHub Linux CI passes. It builds the worker image, checks
   that image ENV has no database/token secrets, loads the actual Linux Prisma
   engine, and runs direct-Node import smoke checks with networking disabled.
   None of these CI commands invokes the bot entrypoint or pushes an image.
2. Prepare a separate clean release worktree/clone at that reviewed commit on
   a worker-only branch named deploy/komu-bot. Do not repurpose the dashboard's
   main branch. In that separate checkout, create these two root files by exact
   copy (not by changing their contents):

~~~powershell
Copy-Item -LiteralPath 'deploy/bot/Dockerfile' -Destination 'Dockerfile'
Copy-Item -LiteralPath 'deploy/bot/Dockerfile.dockerignore' -Destination 'Dockerfile.dockerignore'
~~~

   Review and validate that worker-only branch before any later authorized
   commit/push/configuration action. The nested generation config and sources
   stay at their existing paths; the Docker build context remains repo root.
   Root copies must never be merged back into the dashboard branch.
3. Record the worker's last known-good deployment/image, source commit, build
   type, start configuration, port and health settings without exporting secret
   values. A source/build-type change may trigger deployment immediately: do not
   save changes before deployment is explicitly approved.
4. When approved, configure ONLY komu-bot:

| Field | Value |
| --- | --- |
| Repository | M-3O/komu |
| Source branch | deploy/komu-bot, pinned/reviewed release commit |
| Build type | Dockerfile |
| Build context | Repository root |
| Dockerfile | Root Dockerfile copied above |
| Build command | Dockerfile instructions; remove stale Railpack command overrides |
| Start command | Image CMD; remove stale npm/Next.js start overrides |
| Application port | 3001, matching PORT=3001 |
| Health path | /health |
| Instances | One active gateway worker using this token |

   Preserve the existing runtime DATABASE_URL and Discord credentials in CranL;
   never replace them with the build placeholder or provide them as build args.
   NODE_ENV must be production. Keep KOMU_DATABASE_TARGET and
   KOMU_NEON_TEST_DATABASE_URL unset. Existing BOT_MONITORING_SECRET remains
   runtime-only. No dotenv file needs to be shipped with the worker.
5. Leave komu unchanged: its approved dashboard branch (normally main), Railpack,
   npm run build, npm run start, current port, environment and stream settings.
6. Confirm one active bot during rollout and rollback. CranL rolling replacement
   overlap/old-instance termination behavior has not been verified; coordinate
   an approved worker maintenance window if required. Never start a local bot
   alongside the hosted instance. After an approved deployment, check startup,
   gateway readiness and protected monitoring without triggering announcements
   or database test writes automatically.

If CranL later verifies a custom Dockerfile path, the same reviewed Dockerfile
can be selected directly without worker-branch root copies. If worker-only
Railpack options are positively verified instead, npm run build:bot is now
credential-free; use that and npm run bot on the WORKER ONLY. Neither alternative
is assumed to be supported by the current CranL integration.

## Rollback

- Roll back only komu-bot to its recorded known-good worker image/deployment.
  Keep one active gateway instance. A failed Railpack build that selects the
  dashboard is not a known-good rollback target.
- Preserve runtime secrets, DATABASE_URL, schema, completions and XP. No database
  rollback, migration, reset, data cleanup or announcement replay is needed.
- Preserve the atomic-payout/idempotency fixes when selecting an older source
  release. Keep the dashboard app and its deployment configuration unchanged.
- If a previous image cannot be restored, prepare a worker branch from the
  known-good application commit with the reviewed worker container packaging,
  re-run Linux image verification, and obtain approval before deploying it.
- The worker-only branch must be advanced deliberately for each release; it
  does not automatically follow main. Retain/review the two root copies there.

## Local verification limits

Docker/Podman/Railpack are not installed in the current Windows session. A
Linux container build and native engine loading cannot be claimed locally.
The added CI checks must pass before any release. Local Prisma generation,
direct-Node import smoke, unit regressions, typecheck and lint are safe without
Neon credentials or a database. CI/build network access is limited to public
base images/packages/engine downloads; no database credentials are supplied.
