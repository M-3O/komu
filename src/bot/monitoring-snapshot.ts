import { isErrorCode } from "@/lib/monitoring/errors";
import { health, type Component, type HealthSnapshot, type HealthState } from "@/lib/monitoring/health";
import { GATEWAY_REASONS, type GatewaySnapshot } from "./gateway-health";

const BOT_COMPONENTS: readonly Component[] = ["database.progression", "database.challenge-payout",
  "job.roles", "job.rewards", "job.challenge-progress", "job.challenge-payout",
  "job.challenge-announcement", "job.achievements", "job.progression", "job.bot-event"];
export interface BotMonitoringSnapshot {
  generatedAt: number;
  state: HealthState;
  gateway: GatewaySnapshot;
  inFlight: number;
  components: HealthSnapshot[];
}
const states: readonly unknown[] = ["healthy", "degraded", "unhealthy", "unknown"];
const timestamp = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const count = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1_000_000, Math.floor(value))) : 0;

/** Explicit serialization boundary, including when a callback supplies extra fields. */
export function projectBotSnapshot(input: BotMonitoringSnapshot): BotMonitoringSnapshot {
  const source = input.gateway;
  const gateway: GatewaySnapshot = {
    state: states.includes(source.state) ? source.state : "unknown",
    reason: GATEWAY_REASONS.includes(source.reason) ? source.reason : "GATEWAY_UNAVAILABLE",
    ready: source.ready === true,
    observedAt: timestamp(source.observedAt) ?? 0,
    lastReadyAt: timestamp(source.lastReadyAt), unavailableSince: timestamp(source.unavailableSince),
    graceUntil: timestamp(source.graceUntil),
  };
  const components = BOT_COMPONENTS.map(component => {
    const entry = input.components.find(value => value.component === component);
    return { component, state: entry && states.includes(entry.state) ? entry.state : "unknown",
      stale: entry?.stale !== false, lastSuccessAt: timestamp(entry?.lastSuccessAt),
      lastFailureAt: timestamp(entry?.lastFailureAt), lastObservedAt: timestamp(entry?.lastObservedAt),
      lastError: isErrorCode(entry?.lastError) ? entry.lastError : null,
      consecutiveFailures: count(entry?.consecutiveFailures), recentFailureCount: count(entry?.recentFailureCount) } satisfies HealthSnapshot;
  });
  const allStates = [gateway.state, ...components.map(entry => entry.state)];
  const state: HealthState = allStates.includes("unhealthy") ? "unhealthy" : allStates.includes("degraded") ? "degraded" : gateway.state;
  return { generatedAt: timestamp(input.generatedAt) ?? 0, state, gateway, inFlight: count(input.inFlight), components };
}
export function botMonitoringSnapshot(gateway: GatewaySnapshot, inFlight: number): BotMonitoringSnapshot {
  return projectBotSnapshot({ generatedAt: Date.now(), state: gateway.state, gateway, inFlight, components: health.snapshot() });
}
