import { z } from "zod";
import { ERROR_CODES } from "./errors";
import type { HealthState } from "./health";

export const LOCAL_COMPONENTS = ["discord.read", "discord.write", "database.stream-load", "database.stream-session", "database.stream-record", "database.stream-close", "database.stream-delivery", "provider.TWITCH", "provider.KICK", "provider.YOUTUBE"] as const;
export const POLLER_KEYS = ["all", "fast", "youtube"] as const;
export const REFRESH_MS = 30_000;
export const SNAPSHOT_FRESH_MS = 90_000;
export const OPERATION_FRESH_MS = 300_000;
export const STATES = ["healthy", "degraded", "unhealthy", "unknown"] as const;
export const REASONS = ["OBSERVED", "STALE", "NOT_OBSERVED", "SOURCE_UNAVAILABLE", "NOT_REGISTERED", "WORKER_NOT_CONNECTED"] as const;
const stamp = z.number().int().nonnegative().max(8_640_000_000_000_000).nullable();
const count = z.number().int().min(0).max(1_000_000);
const observation = z.object({
  state: z.enum(STATES), stale: z.boolean(), reason: z.enum(REASONS),
  lastObservedAt: stamp, lastSuccessAt: stamp, lastFailureAt: stamp,
  lastError: z.enum(ERROR_CODES).nullable(), consecutiveFailures: count,
}).strict();
export const snapshotSchema = z.object({
  version: z.literal(1), generatedAt: z.number().int().nonnegative().max(8_640_000_000_000_000),
  scope: z.literal("dashboard-process"),
  worker: z.object({ state: z.literal("unknown"), reason: z.literal("WORKER_NOT_CONNECTED") }).strict(),
  components: z.array(observation.extend({ component: z.enum(LOCAL_COMPONENTS) }).strict()).length(LOCAL_COMPONENTS.length),
  pollers: z.array(observation.extend({
    key: z.enum(POLLER_KEYS), registered: z.boolean(), intervalMs: z.number().int().min(15_000).max(86_400_000).nullable(),
    inFlight: z.boolean(), checked: count.nullable(), alerted: count.nullable(), skipped: count.nullable(), unchanged: count.nullable(), failed: count.nullable(),
  }).strict()).length(POLLER_KEYS.length),
}).strict().refine(s => new Set(s.components.map(c => c.component)).size === LOCAL_COMPONENTS.length && new Set(s.pollers.map(p => p.key)).size === POLLER_KEYS.length);
export type DashboardSnapshot = z.infer<typeof snapshotSchema>;
export type Observation = z.infer<typeof observation>;
export type Poller = DashboardSnapshot["pollers"][number];
export const COMPONENT_LABELS: Record<(typeof LOCAL_COMPONENTS)[number], string> = {
  "discord.read": "Discord REST reads", "discord.write": "Discord REST delivery",
  "database.stream-load": "Load stream accounts", "database.stream-session": "Read stream sessions",
  "database.stream-record": "Record stream sessions", "database.stream-close": "Close stream sessions",
  "database.stream-delivery": "Record stream delivery", "provider.TWITCH": "Twitch", "provider.KICK": "Kick", "provider.YOUTUBE": "YouTube",
};
export function initialSnapshotAge(generatedAt: number, wallNow: number): number {
  const age = wallNow - generatedAt;
  return !Number.isFinite(age) || age < 0 ? SNAPSHOT_FRESH_MS + 1 : age;
}
export function operationFreshness(component: string): number { return component === "provider.YOUTUBE" ? 65 * 60_000 : OPERATION_FRESH_MS; }
export function pollerFreshness(interval: number | null): number { return Math.max(OPERATION_FRESH_MS, (interval ?? 0) * 2 + 30_000); }
export function aggregate(states: HealthState[]): HealthState {
  if (!states.length) return "unknown";
  return states.includes("unhealthy") ? "unhealthy" : states.includes("degraded") ? "degraded" : states.includes("unknown") ? "unknown" : "healthy";
}
/** Age the display without clearing or changing Phase 1A incident history. */
export function dashboardView(snapshot: DashboardSnapshot, now: number, unavailable = false) {
  const expired = unavailable || now - snapshot.generatedAt > SNAPSHOT_FRESH_MS || now < snapshot.generatedAt;
  function age<T extends Observation>(entry: T, freshness: number): T {
    const stale = expired || entry.stale || entry.lastObservedAt === null || entry.lastObservedAt > now || now - entry.lastObservedAt > freshness;
    return { ...entry, stale, state: stale ? "unknown" : entry.state };
  }
  const components = snapshot.components.map(c => age(c, operationFreshness(c.component)));
  const pollers = snapshot.pollers.map(p => age(p, pollerFreshness(p.intervalMs)));
  const database = aggregate(components.filter(c => c.component.startsWith("database.")).map(c => c.state));
  const polling = aggregate(pollers.filter(p => p.registered).map(p => p.state));
  return { components, pollers, database, polling, state: aggregate([database, polling, "unknown"]), expired };
}
