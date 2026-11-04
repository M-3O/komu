import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPONENTS, FAILURE_WINDOW_MS, FRESHNESS_MS, HealthRegistry, health, observeOperation } from "./health";

afterEach(() => vi.restoreAllMocks());
const component = "job.challenge-payout";
const read = (registry: HealthRegistry) => registry.snapshot().find(s => s.component === component)!;

describe("bounded process health", () => {
  it("quiet/unconfigured components stay unknown without failing", () => {
    const registry = new HealthRegistry(() => 1000);
    expect(registry.snapshot()).toHaveLength(COMPONENTS.length);
    expect(registry.snapshot().every(s => s.state === "unknown" && s.consecutiveFailures === 0)).toBe(true);
    registry.begin(component, "job")("skipped");
    expect(read(registry).lastObservedAt).toBeNull();
  });
  it("tracks success, failure, escalation, recovery and freshness", () => {
    let now = 1000;
    const registry = new HealthRegistry(() => now);
    registry.begin(component, "job")("success");
    expect(read(registry)).toMatchObject({ state: "healthy", lastSuccessAt: 1000 });
    registry.begin(component, "job")("failure", new Error("secret"));
    expect(read(registry)).toMatchObject({ state: "degraded", lastFailureAt: 1000, consecutiveFailures: 1, lastError: "JOB_FAILED" });
    registry.begin(component, "job")("failure"); registry.begin(component, "job")("failure");
    expect(read(registry).state).toBe("unhealthy");
    now += FRESHNESS_MS + 1;
    expect(read(registry)).toMatchObject({ state: "unhealthy", stale: true });
    registry.begin(component, "job")("success");
    expect(read(registry)).toMatchObject({ state: "healthy", consecutiveFailures: 0, lastError: "JOB_FAILED" });
    now += FRESHNESS_MS + 1;
    expect(read(registry).state).toBe("unknown");
  });
  it("uses a two-minute failure window and immediate credential escalation", () => {
    let now = 1000; const registry = new HealthRegistry(() => now);
    registry.begin(component, "job")("failure");
    now += FAILURE_WINDOW_MS + 1;
    registry.begin(component, "job")("failure");
    expect(read(registry)).toMatchObject({ consecutiveFailures: 2, recentFailureCount: 1, state: "degraded" });
    registry.begin("discord.write", "discord")("failure", { status: 401 });
    expect(registry.snapshot().find(s => s.component === "discord.write")?.state).toBe("unhealthy");
  });
  it("keeps unrelated successes and skipped work from clearing an incident", () => {
    const registry = new HealthRegistry(() => 1000);
    registry.begin(component, "job")("failure");
    registry.begin("job.roles", "job")("success");
    registry.begin(component, "job")("skipped");
    expect(read(registry)).toMatchObject({ state: "degraded", consecutiveFailures: 1 });
  });
  it("does not let an older overlapping success clear a newer failure", () => {
    const registry = new HealthRegistry(() => 1000);
    const older = registry.begin(component, "job"), newer = registry.begin(component, "job");
    newer("failure", { code: "P1001" }); older("success"); older("success");
    expect(read(registry)).toMatchObject({ state: "degraded", consecutiveFailures: 1, lastError: "DATABASE_UNREACHABLE" });
  });
  it("ignores an old overlapping failure after a newer successful verification", () => {
    const registry = new HealthRegistry(() => 1000);
    const older = registry.begin(component, "job"), newer = registry.begin(component, "job");
    newer("success"); older("failure");
    expect(read(registry)).toMatchObject({ state: "healthy", consecutiveFailures: 0 });
  });
  it("is bounded, detached, and never retains error input", () => {
    const registry = new HealthRegistry(() => 1000);
    for (let i = 0; i < 2000; i++) registry.begin(('secret-' + i) as typeof component, "job")("failure");
    registry.begin(component, "job")("failure", { code: "secret", message: "postgresql://secret", stack: "secret" });
    const snapshot = registry.snapshot(); snapshot[0].lastError = "JOB_PARTIAL";
    expect(JSON.stringify(registry.snapshot())).not.toContain("secret");
    expect(registry.snapshot()).toHaveLength(COMPONENTS.length);
    expect(registry.snapshot()[0].lastError).toBeNull();
  });
  it("allows the slow YouTube observation cadence without false failures", () => {
    let now = 1000; const registry = new HealthRegistry(() => now);
    registry.begin("provider.YOUTUBE", "provider")("success"); now += 31 * 60_000;
    expect(registry.snapshot().find(s => s.component === "provider.YOUTUBE")?.state).toBe("healthy");
    now += 35 * 60_000;
    expect(registry.snapshot().find(s => s.component === "provider.YOUTUBE")?.state).toBe("unknown");
  });
});

describe("non-interfering observation wrapper", () => {
  it("preserves exact object results and rejection identity", async () => {
    const value = { value: 1 }, error = new Error("original");
    expect(await observeOperation(component, "job", async () => value)).toBe(value);
    await expect(observeOperation(component, "job", async () => { throw error; })).rejects.toBe(error);
  });
  it("ignores broken observers and summaries without retrying work", async () => {
    const operation = vi.fn(async () => 42);
    vi.spyOn(health, "begin").mockImplementation(() => { throw Error("observer"); });
    expect(await observeOperation(component, "job", operation)).toBe(42);
    expect(await observeOperation(component, "job", operation, () => { throw Error("summary"); })).toBe(42);
    expect(operation).toHaveBeenCalledTimes(2);
  });
  it("ignores a throwing completion callback on both success and failure", async () => {
    vi.spyOn(health, "begin").mockReturnValue(() => { throw Error("observer"); });
    expect(await observeOperation(component, "job", async () => 42)).toBe(42);
    const error = new Error("original");
    await expect(observeOperation(component, "job", async () => { throw error; })).rejects.toBe(error);
  });
});


it("handles overlapping asynchronous operations without an old success clearing a failure", async () => {
  const registry = new HealthRegistry();
  vi.spyOn(health, "begin").mockImplementation(registry.begin.bind(registry));
  let resolveOld!: (value: number) => void;
  const old = observeOperation(component, "job", () => new Promise<number>(resolve => { resolveOld = resolve; }));
  const error = { code: "P1001" };
  const newer = observeOperation(component, "job", async () => { throw error; });
  await expect(newer).rejects.toBe(error);
  resolveOld(42); expect(await old).toBe(42);
  expect(read(registry)).toMatchObject({ state: "degraded", consecutiveFailures: 1, lastError: "DATABASE_UNREACHABLE" });
});
