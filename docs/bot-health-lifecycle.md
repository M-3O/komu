# Phase 1B: bot health and lifecycle

The dashboard and bot remain independent applications. No coordinator, UI,
network polling, database heartbeat, external service, migrations or environment
changes are introduced. Payout transactions and announcement delivery are unchanged.

## Existing public contract

GET/HEAD / and /health keep the existing shape:
status (ok or starting), botReady, uptimeSeconds. A ready gateway returns 200;
startup, disconnection, shutdown and fatal failure return 503. No database,
job, permission, identity, or configuration details appear publicly.

Readiness checks client.isReady(), manager status and every assigned shard.
The installed discord.js can keep the manager's status Ready while individual
shards reconnect; client-wide readiness alone is insufficient. Missing assigned
shards also fail readiness. Login resolving and a historical ready event are
not enough. Quiet servers do not need messages, reactions or user activity.

Protected gateway state is degraded for the first 90 seconds of startup or a
continuous observed disconnection, then unhealthy. Repeated reconnect events do
not reset that grace period. Actual recovery restores healthy state, including
fresh identification and resume paths. Invalidation fails closed until client
readiness is reestablished. Grace affects detailed classification only: it does
not turn a disconnected gateway's public 503 into 200.

## Protected endpoint

GET/HEAD /internal/health uses the existing listener on PORT (default 3001).
Only the worker needs BOT_MONITORING_SECRET. Choose a separate high-entropy
random secret, 32-256 printable ASCII characters without spaces. Do not reuse a
Discord token or STREAM_POLL_SECRET, put it in source/control files, prefix it
NEXT_PUBLIC_, put it in query strings or send it to browser code. Configuration
is captured at startup; rotation requires a worker restart.

Send the secret only in the x-komu-monitoring-secret header, over a verified
HTTPS or verified encrypted private connection. Header digests are compared
using timingSafeEqual. Missing/invalid server configuration returns generic
503. Missing/wrong client authentication returns generic 401 without reading
any snapshot. Query-string authentication is not accepted. Other authenticated
methods return 405. Responses use Cache-Control: no-store and do not enable CORS.

A successfully authenticated snapshot returns 200 even when health is degraded
or unhealthy; inspect its state. Internal snapshot failure returns generic 503,
never its exception. Authentication never calls Discord or PostgreSQL.

Snapshot fields:

- generatedAt: Unix epoch milliseconds.
- state: healthy, degraded, unhealthy or unknown.
- gateway: state, fixed reason, ready, observedAt, lastReadyAt,
  unavailableSince and graceUntil (epoch milliseconds, nullable where applicable).
- inFlight: bounded scalar count of accepted bot event operations.
- components: ten fixed worker component names with Phase 1A state, stale,
  success/failure/observation timestamps, fixed lastError and failure counts.

The serialization boundary projects fields explicitly, validates the vocabulary,
and includes no guild/user/channel identifiers, messages, connection details,
error objects, stacks, headers or secrets. Returned snapshots are detached.
Unknown components are omitted. Unknown/stale operation observations are not
proof of a dependency outage; quiet/unconfigured work remains unknown.
The overall state does not claim unobserved database operations are healthy.

The new job.bot-event component is a fixed twentieth Phase 1A registry key. It
observes unexpected event-handler failures independently of progression/payout
incidents. Normal event completion cannot recover another component's incident.

## Shutdown and supervision

Message, reaction, member join, command and ready handlers are tracked with a
scalar in-flight count. There is no queue, operation-history map, or concurrency
limit. Handler results, reward sequencing and transaction logic remain intact.
Expected handler rejections are contained, safely classified and recorded as
job outcomes, so transient Discord/database failures do not request an exit.

SIGINT/SIGTERM immediately stop accepting new event work and make readiness
false. Accepted work gets up to 15 seconds to drain while the gateway and DB
remain available. Then health listener, client and Prisma cleanup are attempted
independently. The total shutdown deadline is 20 seconds. Clean signal shutdown
exits 0; drain timeout, cleanup failure or deadline expiry exits 1.

An unknown unhandled rejection or uncaught exception marks the bot fatal and
unready immediately. It stops admitting work, skips a normal drain and attempts
best-effort cleanup within five seconds, then exits nonzero. Repeated errors do
not extend the deadline. Fatal errors during a signal drain escalate it. Raw
process errors are never logged. Node advises against resuming normal operation
after uncaught exceptions:
https://nodejs.org/docs/latest-v24.x/api/process.html#warning-using-uncaughtexception-correctly

No automatic process exit is requested by gateway grace expiry, database health
state, or recoverable Discord client errors. discord.js continues its normal
reconnection behavior. The external supervisor owns restart policy; this phase
does not change or verify CranL's actual restart settings. Public health remains
503 during disconnection, so the existing platform probe policy may still
restart an unhealthy worker. Verify that policy and its startup grace before
release. The platform termination allowance should accommodate the 20-second
shutdown budget; this has not been verified on CranL.

A drain deadline or fatal termination can interrupt already-running work. The
existing transaction/announcement idempotency mechanisms remain authoritative;
this phase does not retry or reconcile work. JavaScript timers cannot enforce a
shutdown deadline if the event loop is completely blocked; supervisor hard
termination remains necessary for that case. In-flight counts and all health
state reset on restart.

## CranL communication path: documented capability versus verified deployment

Official CranL documentation describes a default HTTPS *.cranl.net domain for
each app, forwarding to its configured port, and requires listening on 0.0.0.0:
https://docs.cranl.com/platform/applications.html
https://docs.cranl.com/platform/domains-ssl.html

That documents a possible dashboard-server -> worker HTTPS path. It does NOT
verify that this worker currently has a usable domain, ingress, correct port,
header forwarding, uncached routing or access from the dashboard container.
No CranL account settings, production routes or secret values were accessed.
No private service DNS/name or app-to-app private networking guarantee was found
in the reviewed documentation. Do not assume localhost, a container IP, app name
or an invented internal hostname connects the two applications.

Before Phase 1C, an operator must independently confirm an existing worker route
and test unauthenticated rejection, authenticated safe output and no caching
from the dashboard's execution environment. If no route exists, Phase 1C must
wait for an explicitly approved networking approach; do not add a DB heartbeat,
third worker, paid service or credentials in browser code as a workaround.
The eventual dashboard proxy should pin one verified origin, disallow redirects,
use a deadline, validate the snapshot schema and keep the secret server-side.

## Local verification

Unit tests use fake Discord clients/process sources, injected cleanup functions,
clocks and temporary loopback HTTP servers. They never log into Discord or
connect to PostgreSQL. Real database integration tests remain excluded from the
unit suite. Existing payout concurrency/rollback and announcement regression
suites remain required. No production test or deployment is part of this phase.
