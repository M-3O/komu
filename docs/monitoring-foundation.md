# Phase 1A monitoring foundation

This phase adds process-local observations only. It adds no HTTP endpoint,
UI, timers, network probes, Prisma client, database objects, retries, alerts,
or environment settings. Existing public bot health responses are unchanged.

## Registry and classification

Use the fixed Component union in src/lib/monitoring/health.ts. Never construct
keys from guilds, members, channels, URLs, messages or error text. At most 19
entries exist, each with scalar timestamps, bounded counters and one fixed
ErrorCode. There is no retained event history, exception, promise or payload.
The shared registry lives on globalThis within each process; it is not shared
between the dashboard and the bot and resets on process restart.

The classifier reads only structured code/status/name metadata, tolerates
throwing getters and proxies, and returns an allowlisted code. It does not
inspect messages, stacks, causes, credentials or connection URLs. Unknown errors
use domain-specific fixed fallback codes. Returned partial background results
use JOB_PARTIAL; their raw reasons are not parsed or copied into monitoring.

## State policy

- unknown: no completed verification, or an otherwise healthy observation older
  than five minutes. YouTube freshness is 65 minutes for the slow poll cadence.
- healthy: a fresh successful verification with no active failure.
- degraded: an observed failure below the escalation threshold.
- unhealthy: three ordered failures within a two-minute window without a
  relevant success, or an immediate Discord/database authentication failure.

Once unhealthy, an incident stays unhealthy until a relevant success. Aging a
failure never silently changes it to healthy/unknown; stale=true marks old
failure evidence. lastError remains the historical last failure code after
recovery; use state and consecutiveFailures to determine whether it is active.
consecutiveFailures counts failures since success; recentFailureCount is the
separate escalation-window count. Both saturate at one million.

Skipped, disabled, unconfigured and duplicate/no-op work does not record a
success or failure. No recent member activity is not an outage. No database
heartbeat is performed. Observation freshness alone cannot prove current
availability, actual stream schedule health or the absence of pending work.

Observations receive a start sequence, complete once, and update synchronously.
An older overlapping operation still updates factual completion timestamps but
cannot replace the newer operation's health decision. Different components
never recover each other. Components aggregate the same operation across all
resources; they are not a per-channel incident ledger.

## Instrumentation boundaries

Discord REST reads and writes are independent. Failed HTTP results, transport
errors and body parsing failures are observed without adding retries or
changing returned results/rejections. HTTP status is retained internally for
classification even when Discord returns a numeric error code.

Stream database loading, session reads, session creation, closure and delivery
recording have separate components. Provider observations are scoped to Twitch,
Kick or YouTube. Progression stages observe both thrown exceptions and existing
partial results. The payout observer wraps the existing transaction externally;
XP, payout marker, row locks, isolation, timeouts and external-role ordering are
unchanged. A duplicate payout transaction is skipped, not a recovery signal.

Stream cycle counts now distinguish failed operations, intentional skips,
unchanged/offline results and successfully recorded deliveries. Failure labels
contain only a provider and a fixed error code. lastSucceededAt advances only
on a cycle without failures; lastFinishedAt still records any completed cycle.
The retained poller snapshot explicitly projects allowed fields, stores at most
32 failure details and returns detached copies. Its failed array can be truncated;
the cycle result itself retains all failures for the existing caller.

Delivery policy is unchanged: existing stream sessions are not automatically
resent. A Discord-accepted message whose database mark fails is reported as
STREAM_DELIVERY_RECORD_FAILED, not a successful or unchanged operation.
Challenge announcement claims, retry timing and delivery logic are untouched.

## Safety and remaining scope

Observation callbacks and summary failures are contained. The wrapper returns
the original result or rejection and never re-executes the business operation.
It performs bounded synchronous memory work and no I/O. Unit tests inject broken
observers, transport/database failures, partial outcomes and concurrent payouts.

This is not a global legacy-log sanitization project. Existing application logs
outside the instrumented paths can still contain raw error messages; do not
publish them or expose them through future health endpoints. Health snapshots
must remain a separate allowlisted serialization boundary.

Phase 1B should add correct gateway/lifecycle tracking and a dedicated protected
bot snapshot endpoint, with authentication, schema validation and unchanged
public liveness contracts. UI, cross-app polling and incident notification
coordination should remain separate follow-up work.
