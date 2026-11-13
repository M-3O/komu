import { describe, expect, it } from "vitest";
import { projectDashboardSnapshot } from "./dashboard-projection";
import { aggregate, dashboardView, initialSnapshotAge, LOCAL_COMPONENTS, snapshotSchema, SNAPSHOT_FRESH_MS, WORKER_HEARTBEAT_FRESH_MS } from "./dashboard-model";

const now = 10_000_000;
function entry(component = "discord.read", values: object = {}) {
  return { component, state: "healthy", stale: false, lastObservedAt: now, lastSuccessAt: now, lastFailureAt: null, lastError: null, consecutiveFailures: 0, ...values };
}
function timer(values: object = {}) {
  return { key: "fast", intervalMs: 60_000, lastFinishedAt: new Date(now).toISOString(), lastSucceededAt: new Date(now).toISOString(), inFlight: false, lastError: null,
    lastResult: { checked: 0, alerted: 0, skipped: 0, unchanged: 0, failed: [] }, ...values };
}
describe("safe, process-scoped monitoring projection", () => {
  it("projects a fixed bounded vocabulary and never infers worker health", () => {
    const s = projectDashboardSnapshot(LOCAL_COMPONENTS.map(c => entry(c)), [timer()], now);
    expect(snapshotSchema.safeParse(s).success).toBe(true);
    expect(s.components).toHaveLength(10); expect(s.pollers).toHaveLength(3);
    expect(s.worker).toBeNull();
    expect(dashboardView(s, now).database).toBe("healthy"); expect(dashboardView(s, now).state).toBe("unknown");
  });
  it("uses recent gateway readiness and expires it independently of the dashboard snapshot", () => {
    const lastSeenAt = now - WORKER_HEARTBEAT_FRESH_MS + 1;
    const ready = projectDashboardSnapshot([], [], now, { ready: true, lastSeenAt });
    const connecting = projectDashboardSnapshot([], [], now, { ready: false, lastSeenAt });
    const future = projectDashboardSnapshot([], [], now, { ready: true, lastSeenAt: now + 1 });
    expect(snapshotSchema.safeParse(ready).success).toBe(true);
    expect(dashboardView(ready, now).workerState).toBe("healthy");
    expect(dashboardView(connecting, now).workerState).toBe("degraded");
    expect(dashboardView(ready, now + 1).workerState).toBe("unknown");
    expect(dashboardView(future, now + 1).workerState).toBe("unknown");
    expect(dashboardView(ready, now, true).workerState).toBe("unknown");
  });
  it("never serializes raw metadata, arbitrary keys, errors or worker observations", () => {
    const s = projectDashboardSnapshot([entry("discord.read", { token: "PRIVATE_CANARY", guildId: "PRIVATE_CANARY", lastError: "PRIVATE_CANARY", stack: "PRIVATE_CANARY" }), entry("job.challenge-payout")],
      [timer({ token: "PRIVATE_CANARY", providers: ["PRIVATE_CANARY"], lastResult: { checked: 2, alerted: 0, skipped: 0, unchanged: 0, failed: [{ channel: "PRIVATE_CANARY", reason: "PRIVATE_CANARY" }] } }), timer({ key: "PRIVATE_CANARY" })], now);
    expect(JSON.stringify(s)).not.toContain("PRIVATE_CANARY");
    expect(s.components.some(c => String(c.component).includes("payout"))).toBe(false);
    expect(s.pollers[1].state).toBe("degraded");
  });
  it.each(["degraded", "unhealthy", "healthy"])("shows a stale %s observation as Unknown while retaining history", state => {
    const s = projectDashboardSnapshot([entry("discord.read", { state, lastObservedAt: now - 300_001, lastFailureAt: now - 400_000, lastError: "DISCORD_PERMISSION_DENIED", consecutiveFailures: 3 })], [], now);
    expect(s.components[0]).toMatchObject({ state: "unknown", stale: true, lastError: "DISCORD_PERMISSION_DENIED", consecutiveFailures: 3 });
  });
  it("does not treat a quiet or disabled service as a failure", () => {
    const s = projectDashboardSnapshot([], [], now);
    expect(s.components.every(c => c.state === "unknown")).toBe(true);
    expect(s.pollers.every(p => p.reason === "NOT_REGISTERED")).toBe(true);
  });
  it("supports slow YouTube cadence without accepting expired observations", () => {
    const age = 30 * 60_000;
    const s = projectDashboardSnapshot([entry("provider.YOUTUBE", { lastObservedAt: now - age, lastSuccessAt: now - age })], [timer({ key: "youtube", intervalMs: 1800_000, lastFinishedAt: new Date(now - age).toISOString(), lastSucceededAt: new Date(now - age).toISOString() })], now);
    expect(s.components.find(c => c.component === "provider.YOUTUBE")?.state).toBe("healthy");
    expect(s.pollers[2].state).toBe("healthy");
  });
  it("treats source failures, malformed state and future timestamps conservatively", () => {
    const s = projectDashboardSnapshot(null, null, now);
    expect(s.components.every(c => c.state === "unknown" && c.reason === "SOURCE_UNAVAILABLE")).toBe(true);
    const malformed = projectDashboardSnapshot([entry("discord.read", { state: "private-value", lastObservedAt: now + 1 })], [timer({ lastResult: {} })], now);
    expect(malformed.components[0].state).toBe("unknown"); expect(malformed.pollers[1].state).toBe("unknown");
  });
  it("does not turn in-flight work or a previous success into a completed success", () => {
    const s = projectDashboardSnapshot([], [timer({ lastFinishedAt: null, lastSucceededAt: null, lastResult: null, inFlight: true })], now);
    expect(s.pollers[1]).toMatchObject({ state: "unknown", inFlight: true });
  });
  it("reports current failures separately from skipped and unchanged work", () => {
    const s = projectDashboardSnapshot([], [timer({ lastError: "JOB_PARTIAL", lastResult: { checked: 7, alerted: 0, skipped: 2, unchanged: 4, failed: [{}] } })], now);
    expect(s.pollers[1]).toMatchObject({ state: "degraded", checked: 7, skipped: 2, unchanged: 4, failed: 1 });
  });
  it("does not present retained counts from a previous successful cycle after a thrown failure", () => {
    const s = projectDashboardSnapshot([], [timer({ lastError: "DATABASE_UNREACHABLE" })], now);
    expect(s.pollers[1]).toMatchObject({ state: "degraded", checked: null, alerted: null, failed: null });
  });
  it("bounds counts and rejects extra DTO fields or duplicate component keys", () => {
    const s = projectDashboardSnapshot([entry("discord.read", { consecutiveFailures: Infinity })], [], now);
    expect(s.components[0].consecutiveFailures).toBe(0);
    expect(snapshotSchema.safeParse({ ...s, token: "PRIVATE_CANARY" }).success).toBe(false);
    expect(snapshotSchema.safeParse({ ...s, components: s.components.map(() => s.components[0]) }).success).toBe(false);
  });
  it("expires the browser snapshot and fails refreshes to Unknown without changing registry incidents", () => {
    const s = projectDashboardSnapshot([entry("discord.read", { state: "unhealthy", lastError: "DISCORD_AUTH_FAILED", lastFailureAt: now })], [timer()], now);
    expect(dashboardView(s, now).components[0].state).toBe("unhealthy");
    expect(dashboardView(s, now + SNAPSHOT_FRESH_MS + 1).components[0].state).toBe("unknown");
    expect(dashboardView(s, now, true).polling).toBe("unknown"); expect(s.components[0].state).toBe("unhealthy");
  });
  it("does not treat a cached initial snapshot or an uncertain browser clock as fresh", () => {
    expect(initialSnapshotAge(now, now + 120_000)).toBeGreaterThan(SNAPSHOT_FRESH_MS);
    expect(initialSnapshotAge(now, now - 1)).toBeGreaterThan(SNAPSHOT_FRESH_MS);
  });
  it("does not refresh an old success merely because an older overlapping operation finished later", () => {
    const s = projectDashboardSnapshot([entry("discord.read", { lastSuccessAt: now - 400_000, lastObservedAt: now })], [], now);
    expect(s.components[0]).toMatchObject({ state: "unknown", stale: true });
  });
  it("keeps partial database coverage unknown and visible fresh failures degraded", () => {
    const s = projectDashboardSnapshot([entry("database.stream-load")], [], now);
    expect(dashboardView(s, now).database).toBe("unknown");
    expect(aggregate(["healthy", "unknown", "degraded"])).toBe("degraded");
  });
});
