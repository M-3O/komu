import { Events, Status, type Client } from "discord.js";
import type { HealthState } from "@/lib/monitoring/health";

export const GATEWAY_GRACE_MS = 90_000;
export const GATEWAY_REASONS = ["GATEWAY_READY", "GATEWAY_STARTING", "GATEWAY_RECONNECTING",
  "GATEWAY_UNAVAILABLE", "BOT_SHUTTING_DOWN", "BOT_FATAL"] as const;
export type GatewayReason = (typeof GATEWAY_REASONS)[number];
export interface GatewaySnapshot {
  state: HealthState;
  reason: GatewayReason;
  ready: boolean;
  observedAt: number;
  lastReadyAt: number | null;
  unavailableSince: number | null;
  graceUntil: number | null;
}

/** Gateway state, not guild activity, is authoritative. Reads do no network I/O. */
export class GatewayHealth {
  private everReady = false;
  private lastReadyAt: number | null = null;
  private unavailableSince: number | null;
  private terminal: "BOT_SHUTTING_DOWN" | "BOT_FATAL" | null = null;
  private invalidated = false;
  private readonly refresh = () => { this.snapshot(); };
  private readonly invalidate = () => { this.invalidated = true; this.refresh(); };
  private readonly reidentify = () => { this.invalidated = false; this.refresh(); };

  constructor(private readonly client: Client, private readonly clock: () => number = Date.now) {
    this.unavailableSince = clock();
    client.on(Events.ClientReady, this.reidentify);
    client.on(Events.ShardReady, this.refresh);
    client.on(Events.ShardResume, this.refresh);
    client.on(Events.ShardDisconnect, this.refresh);
    client.on(Events.ShardReconnecting, this.refresh);
    client.on(Events.Invalidated, this.invalidate);
  }

  stop(fatal = false): void {
    if (fatal || this.terminal === null) this.terminal = fatal ? "BOT_FATAL" : "BOT_SHUTTING_DOWN";
  }

  snapshot(): GatewaySnapshot {
    const now = this.clock();
    let ready = false;
    try {
      const assigned = this.client.options?.shards;
      const complete = !Array.isArray(assigned) || assigned.length === 0 ||
        (assigned.length === this.client.ws.shards.size && assigned.every(id => this.client.ws.shards.has(id)));
      ready = complete && !this.terminal && !this.invalidated && this.client.isReady() &&
        this.client.ws.status === Status.Ready && this.client.ws.shards.size > 0 &&
        [...this.client.ws.shards.values()].every(shard => shard.status === Status.Ready);
    } catch { /* A broken client read fails closed, without leaking its error. */ }
    if (ready) {
      if (!this.everReady || this.unavailableSince !== null) this.lastReadyAt = now;
      this.everReady = true;
      this.unavailableSince = null;
    } else if (this.unavailableSince === null) this.unavailableSince = now;
    const graceUntil = this.unavailableSince === null ? null : this.unavailableSince + GATEWAY_GRACE_MS;
    const reason: GatewayReason = this.terminal ?? (ready ? "GATEWAY_READY"
      : graceUntil !== null && now >= graceUntil ? "GATEWAY_UNAVAILABLE"
      : this.everReady ? "GATEWAY_RECONNECTING" : "GATEWAY_STARTING");
    return { state: this.terminal || reason === "GATEWAY_UNAVAILABLE" ? "unhealthy" : ready ? "healthy" : "degraded",
      reason, ready, observedAt: now, lastReadyAt: this.lastReadyAt,
      unavailableSince: this.unavailableSince, graceUntil };
  }

  dispose(): void {
    this.client.off(Events.ClientReady, this.reidentify);
    this.client.off(Events.ShardReady, this.refresh);
    this.client.off(Events.ShardResume, this.refresh);
    this.client.off(Events.ShardDisconnect, this.refresh);
    this.client.off(Events.ShardReconnecting, this.refresh);
    this.client.off(Events.Invalidated, this.invalidate);
  }
}
