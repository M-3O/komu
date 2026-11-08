# Phase 1C: owner-only monitoring dashboard

Status: safe local visibility implemented; worker communication BLOCKED/unverified.
No deployment, database connection, environment change or worker-branch change
has been performed. The owner-only pre-deployment verification remains mandatory:
[owner-only development access](owner-only-development-access.md).

## Supported communication versus actual deployment

The two CranL applications have separate memory and lifecycles. The worker has
no public address in the approved architecture. No configured private route,
private DNS, encrypted app-to-app transport or authenticated dashboard-to-worker
access was supplied or independently verified. No CranL connector was available
and no production request was made.

Official app documentation describes public HTTPS domains, which does not
establish an allowed private path to this worker:
https://docs.cranl.com/platform/applications.html
https://docs.cranl.com/platform/domains-ssl.html

The documented private preview ports and preview tokens apply to Sandboxes,
not evidence of private networking between these deployed Applications:
https://docs.cranl.com/sandboxes/preview-urls.html

Consequently there is NO worker fetcher, invented hostname, localhost fallback,
public exposure, push receiver, cross-app cache or worker coordinator. Worker
gateway, progression, payout and challenge-announcement health are explicitly
Unknown / WORKER_NOT_CONNECTED. Observing Discord REST in the dashboard does
not establish gateway readiness, nor does a dashboard database operation verify
the worker's database selection or payout availability.

## Implemented local observations

/dashboard/monitoring uses the existing visual components and navigation.
A shared server-only reader validates the signed session/account/version via
getCurrentUser and checks the existing authorizeInstallationOwner policy before
reading any observations. The HTTP endpoint uses the same protected reader.
The page redirects refused requests to generic login errors. Direct GET
/api/monitoring returns generic 401, 403 or 503 with no redirect. Cross-site
Origin/Sec-Fetch-Site requests are refused before reading observations.

Successful and refused endpoint responses are private/no-store, vary on Cookie,
set nosniff, expose no CORS grant, and include no identities. No new secrets,
environment variables, schema objects or Prisma clients are required. Existing
public health and secret-authenticated internal APIs are unchanged.

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
returning resumes subject to the same limits. Authorization is rechecked on
EVERY request and is not cached. The existing authentication database reads
are the only database work added by refresh; no scheduled database heartbeat,
provider poll, Discord message or business retry is triggered.

## Remaining release gate and future coordinator

Before cross-app work, obtain provider confirmation of a supported private,
encrypted path for these exact applications, with authentication and no public
worker ingress. Verify it from the dashboard container only under separate
approval: unauthenticated rejection, correctly authenticated safe snapshot,
header forwarding and no caching. Confirm all source/version/port boundaries.
Do not use a CranL account/API key in browser code or a Sandbox preview route
as an invented production app connection.

Only after that verification, design a pinned server-side transport with bounded
requests/deadlines, no redirects, strict worker snapshot validation, freshness
checks and fail-closed server-only secrets. Do not expose the existing worker
endpoint publicly as a workaround. If CranL cannot support the required path,
keep these worker cards Unknown and review architecture separately. No database
heartbeat/table, third app, Redis, queue or paid monitoring service is introduced.

## Verification

Unit tests inject observations, failures, clocks, HTTP responses and database
identity records. They cover projection sanitization, malformed/stale/quiet
sources, all state levels, partial coverage, independent source failures,
real owner authorization, direct HTTP denial, cache headers, bounded refresh,
abort/timeout/backoff, response schema/size limits, and static React rendering.
They do not log into Discord, connect to PostgreSQL, start the live app, send
messages, replay payouts or test production networking. Full unit, typecheck
and lint checks remain required. Real PostgreSQL integration tests are excluded.
