import { EventEmitter } from "node:events";
import { Events, Status, type Client } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HealthRegistry, health } from "@/lib/monitoring/health";
import { startBotRuntime } from "./runtime";
import { BotWorkTracker } from "./work-tracker";
import type { BotHealthServerOptions } from "./health-server";

const logs = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn() }));
vi.mock("@/lib/logger", () => ({ createLogger: () => logs }));
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); logs.error.mockClear(); logs.info.mockClear(); });
function setup() {
  const processSource = new EventEmitter();
  const source = Object.assign(new EventEmitter(), { ws: { status: Status.Connecting, shards: new Map([[0, { status: Status.Connecting }]]) },
    isReady() { return this.ws.status === Status.Ready; }, destroy: vi.fn(async () => {}) });
  let healthOptions!: BotHealthServerOptions;
  const close = vi.fn(async () => {}), disconnect = vi.fn(async () => {}), exit = vi.fn(), login = vi.fn(async () => {}), configure = vi.fn();
  const startHealth = vi.fn(async (options: BotHealthServerOptions) => { healthOptions = options;
    return { port: 3001, close, server: {} } as unknown as Awaited<ReturnType<typeof import('./health-server').startBotHealthServer>>; });
  const options = { client: source as unknown as Client, processSource: processSource as unknown as NodeJS.Process,
    configure, login, disconnectDatabase: disconnect, exit, startHealth, monitoringSecret: 'unit-secret-'.repeat(4), work: new BotWorkTracker() };
  const connect = () => { source.ws.status = Status.Ready; source.ws.shards.get(0)!.status = Status.Ready; source.emit(Events.ClientReady); };
  return { options, source, processSource, close, disconnect, exit, login, configure, startHealth, connect, healthOptions: () => healthOptions };
}

describe("injectable bot runtime (no Discord login or database)", () => {
  it("continues after a heartbeat failure, reports readiness, and stops publishing on shutdown", async () => {
    vi.useFakeTimers();
    const fake = setup();
    const publishHeartbeat = vi.fn<(ready: boolean) => Promise<void>>().mockRejectedValueOnce(Error("offline"));
    publishHeartbeat.mockResolvedValue(undefined);
    const runtime = await startBotRuntime({ ...fake.options, publishHeartbeat });
    expect(publishHeartbeat).toHaveBeenCalledExactlyOnceWith(false);
    expect(fake.login).toHaveBeenCalledTimes(1);
    fake.connect();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(publishHeartbeat).toHaveBeenLastCalledWith(true);
    await runtime.shutdown.request("SIGTERM");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(publishHeartbeat).toHaveBeenCalledTimes(2);
  });
  it("does not infer readiness from login resolving and keeps quiet connected bots healthy", async () => {
    const fake = setup(), runtime = await startBotRuntime(fake.options);
    expect(fake.healthOptions().isReady()).toBe(false); expect(fake.login).toHaveBeenCalledTimes(1);
    fake.connect(); expect(fake.healthOptions().isReady()).toBe(true);
    await runtime.shutdown.request('SIGTERM'); expect(fake.exit).toHaveBeenCalledWith(0);
  });
  it("keeps the process alive after observed database failure and shard reconnection timeout", async () => {
    vi.useFakeTimers(); const registry = new HealthRegistry(); vi.spyOn(health, 'snapshot').mockImplementation(() => registry.snapshot());
    const fake = setup(), runtime = await startBotRuntime(fake.options); fake.connect();
    registry.begin('database.challenge-payout', 'postgres')('failure', { code: 'P1001', message: 'private' });
    expect(fake.healthOptions().isReady()).toBe(true);
    expect(fake.healthOptions().monitoring!.snapshot()).toMatchObject({ state: 'degraded' });
    fake.source.ws.shards.get(0)!.status = Status.Connecting; fake.source.emit(Events.ShardReconnecting, 0);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(runtime.gateway.snapshot()).toMatchObject({ state: 'unhealthy', ready: false });
    expect(fake.exit).not.toHaveBeenCalled(); expect(fake.disconnect).not.toHaveBeenCalled();
    fake.connect(); expect(fake.healthOptions().isReady()).toBe(true);
    await runtime.shutdown.request('SIGTERM');
  });
  it.each(['uncaughtException', 'unhandledRejection'])('fatal %s immediately removes readiness and exits nonzero', async event => {
    const fake = setup(), runtime = await startBotRuntime(fake.options); fake.connect();
    fake.processSource.emit(event, new Error('postgresql://canary-secret'));
    expect(fake.healthOptions().isReady()).toBe(false); expect(runtime.gateway.snapshot().reason).toBe('BOT_FATAL');
    await runtime.shutdown.request('FATAL');
    expect(fake.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(fake.processSource.listenerCount('uncaughtException')).toBe(0);
    expect(JSON.stringify(logs.error.mock.calls)).not.toContain('canary-secret');
  });
  it('cleans up health, client and DB when login fails without exposing the error', async () => {
    const fake = setup(); fake.login.mockRejectedValue(Error('canary-secret'));
    await startBotRuntime(fake.options);
    expect(fake.close).toHaveBeenCalledTimes(1); expect(fake.source.destroy).toHaveBeenCalledTimes(1);
    expect(fake.disconnect).toHaveBeenCalledTimes(1); expect(fake.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(JSON.stringify(logs.error.mock.calls)).not.toContain('canary-secret');
  });
  it('attempts other cleanup when the health listener cannot start', async () => {
    const fake = setup(); fake.startHealth.mockRejectedValue(Error('private'));
    await startBotRuntime(fake.options);
    expect(fake.configure).not.toHaveBeenCalled(); expect(fake.login).not.toHaveBeenCalled();
    expect(fake.source.destroy).toHaveBeenCalledTimes(1); expect(fake.disconnect).toHaveBeenCalledTimes(1);
    expect(fake.exit).toHaveBeenCalledExactlyOnceWith(1);
  });
  it('signals drain accepted work and snapshots stay safe while work is concurrent', async () => {
    const fake = setup(); await startBotRuntime(fake.options); fake.connect();
    let finish!: () => void; const active = fake.options.work.run(() => new Promise<void>(r => { finish = r; }));
    fake.processSource.emit('SIGTERM');
    expect(fake.healthOptions().isReady()).toBe(false);
    for (let i=0;i<50;i++) expect(fake.healthOptions().monitoring!.snapshot()).toMatchObject({ inFlight: 1, gateway: { reason: 'BOT_SHUTTING_DOWN' } });
    expect(fake.disconnect).not.toHaveBeenCalled(); finish(); await active;
    await vi.waitFor(() => expect(fake.exit).toHaveBeenCalledExactlyOnceWith(0));
  });
});


it("a normal signal during login does not become a fatal startup failure", async () => {
  const fake = setup(); let rejectLogin!: (error: Error) => void;
  fake.login.mockImplementation(() => new Promise<void>((_resolve, reject) => { rejectLogin = reject; }));
  fake.source.destroy.mockImplementation(async () => { rejectLogin(Error('cancelled login')); });
  const started = startBotRuntime(fake.options);
  await vi.waitFor(() => expect(fake.login).toHaveBeenCalledTimes(1));
  fake.processSource.emit('SIGTERM'); await started;
  await vi.waitFor(() => expect(fake.exit).toHaveBeenCalledExactlyOnceWith(0));
  expect(logs.error).not.toHaveBeenCalled();
});

it("does not start login if shutdown arrived while the listener was starting", async () => {
  const fake = setup();
  let finishHealth!: (value: Awaited<ReturnType<typeof fake.startHealth>>) => void;
  fake.startHealth.mockImplementation(() => new Promise(resolve => { finishHealth = resolve; }));
  const started = startBotRuntime(fake.options);
  fake.processSource.emit('SIGTERM');
  await vi.waitFor(() => expect(fake.exit).toHaveBeenCalledExactlyOnceWith(0));
  finishHealth({ port: 3001, close: fake.close, server: {} } as unknown as Awaited<ReturnType<typeof fake.startHealth>>);
  await started;
  expect(fake.login).not.toHaveBeenCalled(); expect(fake.configure).not.toHaveBeenCalled(); expect(fake.close).toHaveBeenCalledTimes(1);
});
