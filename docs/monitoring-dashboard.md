# Phase 1C: owner-only monitoring dashboard

See [owner-only development access](owner-only-development-access.md) for
pre-deployment access checks.

## Discord worker heartbeat

The Discord bot writes its gateway readiness and timestamp to one row in the
shared database at startup and roughly every minute. The owner-only dashboard
reads that row during its existing refresh. A heartbeat under three minutes old
shows Healthy when the gateway is ready and Degraded when it is connecting or
disconnected. Missing, stale, future-dated and failed reads show Unknown.
Progression, payouts and challenge announcements remain Unknown on this page.

The heartbeat is off by default. To enable it, apply the
`20261109120000_worker_heartbeat` migration and set
`KOMU_WORKER_MONITORING_ENABLED=true` in both applications. Use the same Neon
database and schema, synchronized clocks and one Discord worker. If two workers
publish, the dashboard shows the last write. Regular heartbeats may keep Neon
compute active.

## Implemented local observations

/dashboard/monitoring uses the existing visual components and navigation.
A shared server-only reader validates the signed session/account/version via
getCurrentUser and checks the existing authorizeInstallationOwner policy before
reading any observations. The HTTP endpoint uses the same protected reader.
The page redirects refused requests to generic login errors. Direct GET
/api/monitoring returns generic 401, 403 or 503 with no redirect. Cross-site
Origin/Sec-Fetch-Site requests are refused before reading observations.

Successful and refused endpoint responses are private/no-store, vary on Cookie,
set nosniff, expose no CORS grant, and include no identities. The heartbeat uses
the existing Prisma client and owner authorization. Existing public health and
secret-authenticated internal APIs are unchanged.

The existing Phase 1A registry provides ten allowlisted local observations:
Discord REST reads/writes, five stream database operations and three streaming
providers. The existing poller status supplies at most three named timers:
all, fast and youtube. Extra keys/fields, arbitrary labels, account/guild IDs,
raw errors, stacks, tokens and URLs are omitted. Counts are bounded and codes
come only from the existing safe vocabulary. Browser responses are schema-
validated and limited to 64 KiB. The page never sends a worker monitoring
secret to the browser or to an unverified address.

The database card aggregates only stream database operations observed here.
The polling card describes completed registered timer cycles, not all provider
or delivery health. Failed, skipped, unchanged and delivered counts remain
separate. A thrown cycle may retain an older result internally; those old counts
are projected as unavailable, never presented as the failed cycle's counts.
External cron cycles can populate individual registry operations
without appearing as a registered in-process timer; an empty timer list is
Unknown, not proof of failure or disabled production configuration.

This is the process that served the request, not a fleet-wide view. A restart,
a separate Next worker/runtime, multiple replicas or another process can yield
empty/different observations. No host/process/guild identifier is exposed and
nothing is merged to create false global health. The overview remains Unknown
while worker coverage is missing; fresh observed failures can still show
Degraded/Unhealthy. The navigation no longer claims Discord is connected based
on a static label.

## State and freshness

Healthy requires recent successful operation evidence. Fresh Phase 1A failure
thresholds remain authoritative (Degraded for an incident, Unhealthy for repeated
or critical failures). Poller errors indicate a failed cycle; historical failure
counts are not invented for timers that do not retain them.

The presentation maps all stale/unavailable observations to Unknown while
retaining safe historical timestamps, last error category and failure count.
This does NOT reset or change the underlying Phase 1A incident registry.
Operation freshness is five minutes, except YouTube's existing 65-minute budget.
Poller freshness is max(five minutes, twice its registered interval + 30 seconds).
No observations, disabled/quiet work and no registered timers are normal Unknown.

A browser snapshot expires after 90 seconds without a successful refresh, even
if its individual observations originally had a longer freshness budget. The
browser uses elapsed monotonic time relative to the snapshot's server clock.
An old initial snapshot or uncertain browser-clock offset is conservatively
expired on hydration and triggers a bounded immediate refresh.
A failed refresh makes displayed current states Unknown immediately and they
stay Unknown throughout retries until a new validated response succeeds. A
401/403 stops refresh and hides the snapshot behind a generic access message.
The existing pure fetch-with-timeout helper is now shared by browser and server
(no server-only configuration or secrets). Its request behavior is unchanged;
all fetch calls continue through that single deadline utility.

## Refresh and load bounds

One same-origin read per visible/online page every 30 seconds, starting after
the initial server-rendered snapshot. One request at a time, eight-second
client deadline, AbortController cleanup, ten-second manual minimum spacing,
60/120/240/300-second failure backoff capped at five minutes. Manual clicks
cannot bypass backoff; no catch-up bursts. Hidden/offline tabs pause requests;
returning resumes subject to the same limits. Each request checks authorization.
Enabled refreshes add one heartbeat lookup after authorization.

## Verification

Unit tests inject observations, failures, clocks, HTTP responses and database
identity records. They cover projection sanitization, malformed/stale/quiet
sources, all state levels, partial coverage, independent source failures,
real owner authorization, direct HTTP denial, cache headers, bounded refresh,
abort/timeout/backoff, response schema/size limits, and static React rendering.
They do not log into Discord, connect to PostgreSQL, start the live app, send
messages, replay payouts or test production networking. Full unit, typecheck
and lint checks remain required. Real PostgreSQL integration tests are excluded.
