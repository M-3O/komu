import { classifyError, type ErrorCode, type ErrorDomain } from "./errors";

/** Fixed operation keys: never append tenant/member/channel identifiers. */
export const COMPONENTS = [
  "discord.read", "discord.write", "database.stream-load", "database.stream-session",
  "database.stream-record", "database.stream-close", "database.stream-delivery", "database.progression",
  "database.challenge-payout", "provider.TWITCH", "provider.KICK", "provider.YOUTUBE",
  "job.roles", "job.rewards", "job.challenge-progress", "job.challenge-payout",
  "job.challenge-announcement", "job.achievements", "job.progression", "job.bot-event",
] as const;
export type Component = (typeof COMPONENTS)[number];
export type HealthState = "healthy" | "degraded" | "unhealthy" | "unknown";
type Outcome = "success" | "failure" | "skipped";
export type Observation = (outcome: Outcome, error?: unknown) => void;
export const FRESHNESS_MS = 5 * 60_000;
export const FAILURE_WINDOW_MS = 2 * 60_000;
const MAX_COUNT = 1_000_000;
const immediate = new Set<ErrorCode>(["DISCORD_AUTH_FAILED", "DATABASE_AUTH_FAILED"]);
interface Entry {
  component: Component;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastObservedAt: number | null;
  lastError: ErrorCode | null;
  consecutiveFailures: number;
  failureWindowStartedAt: number | null;
  latestSequence: number;
  failed: boolean;
  unhealthy: boolean;
  recentFailureCount: number;
}
export interface HealthSnapshot {
  component: Component;
  state: HealthState;
  stale: boolean;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastObservedAt: number | null;
  lastError: ErrorCode | null;
  consecutiveFailures: number;
  recentFailureCount: number;
}
const noop: Observation = () => {};

/** No timers, I/O, retained errors, event history or in-flight operation map. */
export class HealthRegistry {
  private readonly entries = new Map<Component, Entry>();
  private sequence = 0;
  constructor(private readonly clock: () => number = Date.now) {}

  begin(component: Component, domain: ErrorDomain): Observation {
    if (!(COMPONENTS as readonly string[]).includes(component)) return noop;
    const sequence = ++this.sequence;
    let completed = false;
    return (outcome, error) => {
      if (completed) return;
      completed = true;
      if (outcome !== "success" && outcome !== "failure") return;
      try {
        const now = this.clock();
        if (!Number.isFinite(now) || now < 0) return;
        let entry = this.entries.get(component);
        if (!entry) {
          entry = { component, lastSuccessAt: null, lastFailureAt: null, lastObservedAt: null,
            lastError: null, consecutiveFailures: 0, failureWindowStartedAt: null,
            latestSequence: 0, failed: false, unhealthy: false, recentFailureCount: 0 };
          this.entries.set(component, entry);
        }
        // Completion timestamps are factual, even for an older overlapping operation.
        entry.lastObservedAt = now;
        if (outcome === "success") entry.lastSuccessAt = now;
        else entry.lastFailureAt = now;
        // An older completion cannot erase or replace newer operation evidence.
        if (sequence < entry.latestSequence) return;
        entry.latestSequence = sequence;
        entry.failed = outcome === "failure";
        if (!entry.failed) {
          entry.consecutiveFailures = 0;
          entry.recentFailureCount = 0;
          entry.unhealthy = false;
          entry.failureWindowStartedAt = null;
          return;
        }
        if (entry.failureWindowStartedAt === null || now - entry.failureWindowStartedAt > FAILURE_WINDOW_MS) {
          entry.failureWindowStartedAt = now;
          entry.recentFailureCount = 0;
        }
        entry.consecutiveFailures = Math.min(MAX_COUNT, entry.consecutiveFailures + 1);
        entry.recentFailureCount = Math.min(MAX_COUNT, entry.recentFailureCount + 1);
        entry.lastError = classifyError(error, domain);
        entry.unhealthy ||= entry.recentFailureCount >= 3 || immediate.has(entry.lastError);
      } catch { /* Instrumentation must never reject business operations. */ }
    };
  }

  snapshot(): HealthSnapshot[] {
    const now = this.clock();
    return COMPONENTS.map(component => {
      const entry = this.entries.get(component);
      const freshness = component === "provider.YOUTUBE" ? 65 * 60_000 : FRESHNESS_MS;
      const stale = !entry || entry.lastObservedAt === null || now - entry.lastObservedAt > freshness;
      const state: HealthState = entry?.failed
        ? (entry.unhealthy ? "unhealthy" : "degraded")
        : stale ? "unknown" : "healthy";
      return { component, state, stale, lastSuccessAt: entry?.lastSuccessAt ?? null,
        lastFailureAt: entry?.lastFailureAt ?? null, lastObservedAt: entry?.lastObservedAt ?? null,
        lastError: entry?.lastError ?? null, consecutiveFailures: entry?.consecutiveFailures ?? 0, recentFailureCount: entry?.recentFailureCount ?? 0 };
    });
  }
}

// Shared within this process, including development reloads. No cross-app state.
const globalHealth = globalThis as typeof globalThis & { komuHealthRegistry?: HealthRegistry };
export const health = globalHealth.komuHealthRegistry ??= new HealthRegistry();
export function startObservation(component: Component, domain: ErrorDomain): Observation {
  try {
    const finish = health.begin(component, domain);
    return (outcome, error) => { try { finish(outcome, error); } catch { /* Fail open. */ } };
  } catch { return noop; }
}

/** Preserve the exact result/rejection; summaries inspect only existing outcomes. */
export async function observeOperation<T>(
  component: Component, domain: ErrorDomain, operation: () => Promise<T>,
  summarize?: (result: T) => "success" | "skipped" | ErrorCode,
): Promise<T> {
  const finish = startObservation(component, domain);
  try {
    const result = await operation();
    try {
      const summary = summarize?.(result) ?? "success";
      if (summary === "success" || summary === "skipped") finish(summary);
      else finish("failure", { code: summary });
    } catch { /* A broken observer cannot alter a successful result. */ }
    return result;
  } catch (error) {
    finish("failure", error);
    throw error;
  }
}
