import { EventEmitter } from "node:events";
import { Events, Status, type Client } from "discord.js";
import { describe, expect, it } from "vitest";
import { GATEWAY_GRACE_MS, GatewayHealth } from "./gateway-health";

function fakeClient() {
  const shards = new Map([[0, { status: Status.Connecting }], [1, { status: Status.Connecting }]]);
  const source = Object.assign(new EventEmitter(), { options: { shards: [0, 1] }, ws: { status: Status.Connecting, shards }, isReady() { return this.ws.status === Status.Ready; } });
  const client = source as unknown as Client;
  const connected = () => { source.ws.status = Status.Ready; shards.forEach(s => { s.status = Status.Ready; }); };
  return { source, client, shards, connected };
}

describe("actual Discord gateway health", () => {
  it("starts degraded and becomes ready only when the client and every shard are ready", () => {
    let now = 1000; const fake = fakeClient(); const health = new GatewayHealth(fake.client, () => now);
    expect(health.snapshot()).toMatchObject({ ready: false, state: "degraded", reason: "GATEWAY_STARTING", graceUntil: 91_000 });
    fake.source.ws.status = Status.Ready;
    expect(health.snapshot().ready).toBe(false);
    fake.connected(); now += 100; fake.source.emit(Events.ClientReady);
    expect(health.snapshot()).toMatchObject({ ready: true, state: "healthy", lastReadyAt: 1100 });
    now += 24 * 60 * 60_000;
    expect(health.snapshot()).toMatchObject({ ready: true, state: "healthy", lastReadyAt: 1100 });
    health.dispose(); expect(fake.source.listenerCount(Events.ShardReconnecting)).toBe(0);
  });
  it("detects a reconnecting shard even when client-wide readiness is stale", () => {
    let now = 1000; const fake = fakeClient(); const health = new GatewayHealth(fake.client, () => now);
    fake.connected(); health.snapshot(); now += 100;
    fake.shards.get(1)!.status = Status.Connecting; fake.source.emit(Events.ShardReconnecting, 1);
    expect(fake.source.isReady()).toBe(true);
    expect(health.snapshot()).toMatchObject({ ready: false, reason: "GATEWAY_RECONNECTING", unavailableSince: 1100 });
    now += GATEWAY_GRACE_MS; fake.source.emit(Events.ShardReconnecting, 1);
    expect(health.snapshot()).toMatchObject({ state: "unhealthy", reason: "GATEWAY_UNAVAILABLE", unavailableSince: 1100 });
    fake.connected(); fake.source.emit(Events.ShardResume, 1);
    expect(health.snapshot()).toMatchObject({ ready: true, state: "healthy", lastReadyAt: now });
  });
  it("recovers after disconnect and a fresh ready event rather than a resume", () => {
    const fake = fakeClient(); const health = new GatewayHealth(fake.client);
    fake.connected(); fake.source.emit(Events.ClientReady);
    fake.shards.get(0)!.status = Status.Disconnected; fake.source.emit(Events.ShardDisconnect, {}, 0);
    expect(health.snapshot().ready).toBe(false);
    fake.connected(); fake.source.emit(Events.ShardReady, 0); fake.source.emit(Events.ClientReady);
    expect(health.snapshot().ready).toBe(true);
  });
  it("times out startup without messages or a restart timer", () => {
    let now = 0; const fake = fakeClient(); const health = new GatewayHealth(fake.client, () => now);
    now = GATEWAY_GRACE_MS;
    expect(health.snapshot()).toMatchObject({ state: "unhealthy", reason: "GATEWAY_UNAVAILABLE" });
    fake.connected(); expect(health.snapshot().ready).toBe(true);
  });
  it("fails closed for invalidation and client-state read errors", () => {
    const fake = fakeClient(); const health = new GatewayHealth(fake.client);
    fake.connected(); fake.source.emit(Events.Invalidated);
    expect(health.snapshot().ready).toBe(false);
    fake.source.emit(Events.ClientReady); expect(health.snapshot().ready).toBe(true);
    fake.source.isReady = () => { throw Error("canary-secret"); };
    expect(health.snapshot().ready).toBe(false);
    expect(JSON.stringify(health.snapshot())).not.toContain("canary-secret");
  });
  it("never becomes ready again during shutdown or fatal failure", () => {
    const fake = fakeClient(); const health = new GatewayHealth(fake.client);
    fake.connected(); health.stop(); fake.source.emit(Events.ClientReady);
    expect(health.snapshot()).toMatchObject({ ready: false, state: "unhealthy", reason: "BOT_SHUTTING_DOWN" });
    health.stop(true); health.stop();
    expect(health.snapshot().reason).toBe("BOT_FATAL");
  });
});


it("does not report ready when an assigned shard is missing", () => {
  const fake = fakeClient(), health = new GatewayHealth(fake.client);
  fake.connected(); expect(health.snapshot().ready).toBe(true);
  fake.shards.delete(1); expect(health.snapshot().ready).toBe(false);
});
