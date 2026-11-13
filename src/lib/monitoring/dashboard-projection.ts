import { isErrorCode } from "./errors";
import { LOCAL_COMPONENTS, POLLER_KEYS, STATES, operationFreshness, pollerFreshness, type DashboardSnapshot, type Observation } from "./dashboard-model";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const count = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? Math.min(1_000_000, Math.max(0, Math.floor(v))) : 0;
const timestamp = (v: unknown, now: number): number | null => {
  const n = typeof v === "string" ? Date.parse(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= now ? n : null;
};
function observation(input: Record<string, unknown>, now: number, freshFor: number, available: boolean): Observation {
  const lastObservedAt = timestamp(input.lastObservedAt, now);
  const lastSuccessAt = timestamp(input.lastSuccessAt, now);
  const lastFailureAt = timestamp(input.lastFailureAt, now);
  const validState = STATES.includes(input.state as never) ? input.state as Observation["state"] : "unknown";
  const evidenceAt = validState === "healthy" ? lastSuccessAt : validState === "degraded" || validState === "unhealthy" ? lastFailureAt : lastObservedAt;
  const stale = !available || input.stale !== false || lastObservedAt === null || now - lastObservedAt > freshFor || evidenceAt === null || now - evidenceAt > freshFor;
  const state = stale ? "unknown" : validState;
  return { state, stale, reason: !available ? "SOURCE_UNAVAILABLE" : lastObservedAt === null ? "NOT_OBSERVED" : stale ? "STALE" : "OBSERVED",
    lastObservedAt, lastSuccessAt, lastFailureAt,
    lastError: isErrorCode(input.lastError) ? input.lastError : null, consecutiveFailures: count(input.consecutiveFailures) };
}
/** Fixed fields/keys only. Raw snapshots, arbitrary poller keys and errors never escape. */
export function projectDashboardSnapshot(health: unknown, timers: unknown, now: number, worker: DashboardSnapshot["worker"] = null): DashboardSnapshot {
  const healthAvailable = Array.isArray(health), timersAvailable = Array.isArray(timers);
  const components = LOCAL_COMPONENTS.map(component => {
    const raw = record(healthAvailable ? health.find(v => record(v).component === component) : null);
    return { component, ...observation(raw, now, operationFreshness(component), healthAvailable) };
  });
  const pollers = POLLER_KEYS.map(key => {
    const raw = record(timersAvailable ? timers.find(v => record(v).key === key) : null);
    const registered = raw.key === key;
    const intervalMs = typeof raw.intervalMs === "number" && Number.isSafeInteger(raw.intervalMs) && raw.intervalMs >= 15_000 && raw.intervalMs <= 86_400_000 ? raw.intervalMs : null;
    const lastObservedAt = timestamp(raw.lastFinishedAt, now);
    const lastSuccessAt = timestamp(raw.lastSucceededAt, now);
    const result = record(raw.lastResult);
    const failed = Array.isArray(result.failed) ? count(result.failed.length) : 0;
    const validCycle = [result.checked, result.alerted, result.skipped, result.unchanged].every(v => typeof v === "number" && Number.isSafeInteger(v) && v >= 0) && Array.isArray(result.failed);
    const usableResult = validCycle && (raw.lastError == null || raw.lastError === "JOB_PARTIAL");
    const lastError = isErrorCode(raw.lastError) ? raw.lastError : raw.lastError ? "JOB_FAILED" : failed ? "JOB_PARTIAL" : null;
    // Only a completed cycle is evidence. In-flight work cannot create success.
    const state = lastError === "DATABASE_AUTH_FAILED" || lastError === "DISCORD_AUTH_FAILED" ? "unhealthy" : lastError ? "degraded" : lastSuccessAt !== null && validCycle && lastSuccessAt >= (lastObservedAt ?? Infinity) - 1_000 ? "healthy" : "unknown";
    const entry = observation({ state, stale: false, lastObservedAt, lastSuccessAt, lastError,
      lastFailureAt: lastError ? lastObservedAt : null }, now, pollerFreshness(intervalMs), timersAvailable && intervalMs !== null);
    return { key, registered, intervalMs, inFlight: raw.inFlight === true, ...entry,
      reason: !timersAvailable ? "SOURCE_UNAVAILABLE" as const : !registered ? "NOT_REGISTERED" as const : entry.reason,
      checked: usableResult ? count(result.checked) : null, alerted: usableResult ? count(result.alerted) : null, skipped: usableResult ? count(result.skipped) : null, unchanged: usableResult ? count(result.unchanged) : null, failed: usableResult ? failed : null };
  });
  return { version: 2, generatedAt: now, scope: "dashboard-process", worker, components, pollers };
}
