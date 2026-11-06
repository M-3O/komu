import type { GatewayHealth } from "./gateway-health";
import type { BotWorkTracker } from "./work-tracker";

export type ShutdownReason = "SIGINT" | "SIGTERM" | "FATAL" | "STARTUP_FAILURE";
export const SHUTDOWN_DRAIN_MS = 15_000;
export const SHUTDOWN_TOTAL_MS = 20_000;
export const FATAL_SHUTDOWN_MS = 5_000;
export type ShutdownCode = "BOT_SHUTDOWN_COMPLETE" | "BOT_SHUTDOWN_INCOMPLETE";
interface ShutdownOptions {
  gateway: Pick<GatewayHealth, "stop">;
  work: Pick<BotWorkTracker, "stopAccepting" | "drain" | "cancelDrain">;
  closeHealth: () => Promise<unknown>;
  destroyClient: () => Promise<unknown>;
  disconnectDatabase: () => Promise<unknown>;
  exit: (code: number) => void;
  report?: (code: ShutdownCode) => void;
}

/** No restart decisions for dependency outages; only signals and fatal/startup errors. */
export class BotShutdown {
  private pending: Promise<void> | undefined;
  private fatal = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private deadlineAt = 0;
  private deadline!: () => void;
  private abortDrain!: () => void;
  constructor(private readonly options: ShutdownOptions) {}

  request(reason: ShutdownReason): Promise<void> {
    const fatal = reason === "FATAL" || reason === "STARTUP_FAILURE";
    const newlyFatal = fatal && !this.fatal;
    this.options.gateway.stop(fatal);
    this.options.work.stopAccepting();
    if (fatal) this.fatal = true;
    if (this.pending) {
      if (newlyFatal) {
        this.options.work.cancelDrain();
        this.abortDrain();
        clearTimeout(this.timer);
        this.timer = setTimeout(this.deadline, Math.min(FATAL_SHUTDOWN_MS, Math.max(0, this.deadlineAt - Date.now())));
      }
      return this.pending;
    }
    const deadline = new Promise<false>(resolve => { this.deadline = () => resolve(false); });
    const abort = new Promise<void>(resolve => { this.abortDrain = resolve; });
    const budget = fatal ? FATAL_SHUTDOWN_MS : SHUTDOWN_TOTAL_MS;
    this.deadlineAt = Date.now() + budget;
    this.timer = setTimeout(this.deadline, budget);
    const cleanup = async () => {
      let drained = true;
      if (!this.fatal) {
        const result = await Promise.race([this.options.work.drain(SHUTDOWN_DRAIN_MS), abort.then(() => false)]);
        drained = result;
      }
      // Start independently: one stuck cleanup must not prevent the others.
      const outcomes = await Promise.allSettled([
        this.options.closeHealth, this.options.destroyClient, this.options.disconnectDatabase,
      ].map(operation => Promise.resolve().then(operation)));
      return drained && outcomes.every(outcome => outcome.status === "fulfilled");
    };
    this.pending = Promise.race([cleanup().catch(() => false), deadline]).then(complete => {
      clearTimeout(this.timer);
      try { this.options.report?.(complete ? "BOT_SHUTDOWN_COMPLETE" : "BOT_SHUTDOWN_INCOMPLETE"); } catch { /* Logging is best effort. */ }
      this.options.exit(this.fatal || !complete ? 1 : 0);
    });
    return this.pending;
  }
}
