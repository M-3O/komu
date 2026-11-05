import { afterEach, describe, expect, it, vi } from "vitest";
import { BotWorkTracker } from "./work-tracker";
import { BotShutdown } from "./shutdown";

afterEach(() => vi.useRealTimers());
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
const setup = () => {
  const work = new BotWorkTracker();
  const options = { work, gateway: { stop: vi.fn() }, closeHealth: vi.fn(async () => {}), destroyClient: vi.fn(async () => {}), disconnectDatabase: vi.fn(async () => {}), exit: vi.fn(), report: vi.fn() };
  return { options, shutdown: new BotShutdown(options), work };
};

describe("bounded worker drain", () => {
  it("preserves concurrent results and rejection identity without retaining operation data", async () => {
    const work = new BotWorkTracker(), first = deferred<number>(), second = deferred<number>();
    const a = work.run(() => first.promise), b = work.run(() => second.promise);
    expect(work.inFlight).toBe(2); first.resolve(42); expect(await a).toBe(42); expect(work.inFlight).toBe(1);
    second.resolve(7); expect(await b).toBe(7); expect(work.inFlight).toBe(0);
    const error = new Error("original"); await expect(work.run(async () => { throw error; })).rejects.toBe(error);
    expect(work.inFlight).toBe(0);
  });
  it("drains accepted work before disconnecting, and rejects no new work by throwing", async () => {
    const { options, shutdown, work } = setup(), gate = deferred<void>();
    const active = work.run(() => gate.promise);
    const closing = shutdown.request("SIGTERM");
    const extra = vi.fn(async () => {}); expect(await work.run(extra)).toBeUndefined(); expect(extra).not.toHaveBeenCalled();
    expect(options.destroyClient).not.toHaveBeenCalled(); gate.resolve(); await active; await closing;
    expect(options.exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(options.destroyClient).toHaveBeenCalledTimes(1); expect(options.disconnectDatabase).toHaveBeenCalledTimes(1);
    await shutdown.request("SIGINT"); expect(options.exit).toHaveBeenCalledTimes(1);
  });
  it("stops waiting for stuck work at 15 seconds", async () => {
    vi.useFakeTimers(); const { options, shutdown, work } = setup();
    void work.run(() => new Promise(() => {})); const closing = shutdown.request("SIGTERM");
    await vi.advanceTimersByTimeAsync(15_000); await closing;
    expect(options.exit).toHaveBeenCalledExactlyOnceWith(1); expect(options.disconnectDatabase).toHaveBeenCalledTimes(1);
  });
  it("bounds stuck cleanup at 20 seconds while attempting all resources", async () => {
    vi.useFakeTimers(); const { options, shutdown } = setup();
    options.closeHealth.mockImplementation(() => new Promise(() => {}));
    const closing = shutdown.request("SIGINT"); await vi.advanceTimersByTimeAsync(20_000); await closing;
    expect(options.exit).toHaveBeenCalledExactlyOnceWith(1); expect(options.destroyClient).toHaveBeenCalledTimes(1);
    expect(options.disconnectDatabase).toHaveBeenCalledTimes(1);
  });
  it("reports cleanup failure without skipping other cleanup", async () => {
    const { options, shutdown } = setup(); options.destroyClient.mockRejectedValue(Error("secret"));
    await shutdown.request("SIGTERM"); expect(options.disconnectDatabase).toHaveBeenCalledTimes(1);
    expect(options.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(JSON.stringify(options.report.mock.calls)).not.toContain("secret");
  });
  it("fatal shutdown skips draining, cannot report success, and cannot be postponed by repeated errors", async () => {
    vi.useFakeTimers(); const { options, shutdown, work } = setup();
    void work.run(() => new Promise(() => {})); options.disconnectDatabase.mockImplementation(() => new Promise(() => {}));
    const closing = shutdown.request("FATAL"); await vi.advanceTimersByTimeAsync(4000); void shutdown.request("FATAL");
    await vi.advanceTimersByTimeAsync(1000); await closing;
    expect(options.exit).toHaveBeenCalledExactlyOnceWith(1); expect(options.gateway.stop).toHaveBeenCalledWith(true);
  });
  it("escalates a graceful drain when a fatal exception arrives", async () => {
    const { options, shutdown, work } = setup(); void work.run(() => new Promise(() => {}));
    const closing = shutdown.request("SIGTERM"); void shutdown.request("FATAL"); await closing;
    expect(options.exit).toHaveBeenCalledExactlyOnceWith(1);
  });
});


it("contains an event's dependency rejection without invoking process fatal handling", async () => {
  const { botWork, dispatchBotWork } = await import('./work-tracker');
  const operation = vi.fn(async () => { throw { code: 'P1001', message: 'canary-secret' }; });
  dispatchBotWork(operation);
  await vi.waitFor(() => expect(botWork.inFlight).toBe(0));
  expect(operation).toHaveBeenCalledTimes(1);
  const { health } = await import('@/lib/monitoring/health');
  expect(health.snapshot().find(s => s.component === 'job.bot-event')).toMatchObject({ state: 'degraded', lastError: 'DATABASE_UNREACHABLE' });
});


it("a late fatal error does not extend the original total shutdown budget", async () => {
  vi.useFakeTimers(); const { options, shutdown } = setup();
  options.closeHealth.mockImplementation(() => new Promise(() => {}));
  const closing = shutdown.request('SIGTERM'); await vi.advanceTimersByTimeAsync(19_000);
  void shutdown.request('FATAL'); await vi.advanceTimersByTimeAsync(1000); await closing;
  expect(options.exit).toHaveBeenCalledExactlyOnceWith(1);
});
