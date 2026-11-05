import { afterEach, describe, expect, it, vi } from "vitest";
import { HealthRegistry } from "@/lib/monitoring/health";
import { projectBotSnapshot, type BotMonitoringSnapshot } from "./monitoring-snapshot";
import { startBotHealthServer, type BotHealthServer } from "./health-server";

const SECRET = "canary-monitoring-secret-" + "a".repeat(32);
let health: BotHealthServer | undefined;
afterEach(async () => { await health?.close(); health = undefined; });
const snapshot = (): BotMonitoringSnapshot => ({ generatedAt: 1000, state: "healthy", inFlight: 0,
  gateway: { state: "healthy", reason: "GATEWAY_READY", ready: true, observedAt: 1000, lastReadyAt: 1000, unavailableSince: null, graceUntil: null },
  components: new HealthRegistry(() => 1000).snapshot() });
const url = (path = "/internal/health") => 'http://127.0.0.1:' + health!.port + path;
const auth = { "x-komu-monitoring-secret": SECRET };

describe("protected read-only bot snapshot", () => {
  it.each([undefined, "", "short", " ".repeat(32), "a".repeat(257)])("fails closed for unconfigured/invalid secret", async secret => {
    const read = vi.fn(snapshot); health = await startBotHealthServer({ port: 0, isReady: () => true, monitoring: { secret, snapshot: read } });
    const response = await fetch(url(), { headers: auth });
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "Monitoring unavailable." }); expect(read).not.toHaveBeenCalled();
    expect((await fetch(url('/health'))).status).toBe(200);
  });
  it.each([undefined, "", "incorrect", "a".repeat(300)])("rejects missing/incorrect headers without reading state", async secret => {
    const read = vi.fn(snapshot); health = await startBotHealthServer({ port: 0, isReady: () => true, monitoring: { secret: SECRET, snapshot: read } });
    const response = await fetch(url(), { headers: secret === undefined ? {} : { 'x-komu-monitoring-secret': secret } });
    expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: "Not authorised." }); expect(read).not.toHaveBeenCalled();
  });
  it("does not accept query-string credentials or allow state-changing methods", async () => {
    const read = vi.fn(snapshot); health = await startBotHealthServer({ port: 0, isReady: () => true, monitoring: { secret: SECRET, snapshot: read } });
    expect((await fetch(url('/internal/health?secret=' + SECRET))).status).toBe(401);
    expect((await fetch(url(), { method: 'POST', headers: auth })).status).toBe(405);
    expect(read).not.toHaveBeenCalled();
  });
  it("returns sanitized timestamps, fixed reasons, freshness and no extra context", async () => {
    const value = snapshot();
    const corrupted = { ...value, secret: SECRET, stack: 'secret-stack', guildId: 'guild-private',
      gateway: { ...value.gateway, userId: 'member-private', error: new Error('secret-error') },
      components: value.components.map(c => ({ ...c, url: 'postgresql://private', stack: 'secret-stack' })) };
    health = await startBotHealthServer({ port: 0, isReady: () => true, monitoring: { secret: SECRET, snapshot: () => corrupted } });
    const response = await fetch(url(), { headers: auth }); const body = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toMatchObject({ generatedAt: 1000, state: 'healthy', gateway: { reason: 'GATEWAY_READY' } });
    expect(body.components).toHaveLength(10);
    expect(JSON.stringify(body)).not.toMatch(/canary|private|secret-|stack|guildId|userId|postgresql/);
    expect(body.components.find((c: {component: string}) => c.component === 'job.challenge-announcement')).toMatchObject({ state: 'unknown', stale: true });
  });
  it("shows database degradation without changing gateway-only public readiness", async () => {
    const registry = new HealthRegistry(() => 1000); registry.begin('database.challenge-payout', 'postgres')('failure', { code: 'P1001' });
    health = await startBotHealthServer({ port: 0, isReady: () => true,
      monitoring: { secret: SECRET, snapshot: () => ({ ...snapshot(), components: registry.snapshot() }) } });
    expect(await (await fetch(url('/health'))).json()).toMatchObject({ status: 'ok', botReady: true });
    expect(await (await fetch(url(), { headers: auth })).json()).toMatchObject({ state: 'degraded', gateway: { ready: true }, components: expect.arrayContaining([expect.objectContaining({ component: 'database.challenge-payout', lastError: 'DATABASE_UNREACHABLE' })]) });
  });
  it("never serializes callback errors and supports HEAD without a response body", async () => {
    health = await startBotHealthServer({ port: 0, isReady: () => true,
      monitoring: { secret: SECRET, snapshot: () => { throw Error(SECRET); } } });
    const response = await fetch(url(), { headers: auth }); expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(SECRET);
    const head = await fetch(url(), { method: 'HEAD', headers: auth }); expect(head.status).toBe(503); expect(await head.text()).toBe('');
  });
  it("projects only allowed scalar values, including for malformed runtime input", () => {
    const value = snapshot(); value.gateway.reason = 'canary-secret' as typeof value.gateway.reason;
    value.gateway.state = 'canary-secret' as typeof value.gateway.state;
    value.components = [{ ...value.components[0], component: 'database.progression', state: 'canary-secret', lastError: 'canary-secret', lastSuccessAt: 'canary-secret' }] as unknown as typeof value.components;
    const body = projectBotSnapshot(value); expect(JSON.stringify(body)).not.toContain('canary');
    expect(body.gateway).toMatchObject({ state: 'unknown', reason: 'GATEWAY_UNAVAILABLE' });
    expect(body.components[0]).toMatchObject({ state: 'unknown', lastError: null, lastSuccessAt: null });
  });
});


it("supports authenticated HEAD with the same status and no body", async () => {
  health = await startBotHealthServer({ port: 0, isReady: () => true, monitoring: { secret: SECRET, snapshot } });
  const response = await fetch(url(), { method: 'HEAD', headers: auth });
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(Number(response.headers.get('content-length'))).toBeGreaterThan(0); expect(await response.text()).toBe('');
});
