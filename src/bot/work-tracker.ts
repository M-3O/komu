import { createLogger } from "@/lib/logger";
import { classifyError } from "@/lib/monitoring/errors";
import { startObservation } from "@/lib/monitoring/health";

/** One scalar count, no retained events, members, messages, or operation promises. */
export class BotWorkTracker {
  private accepting = true;
  private active = 0;
  private draining: Promise<boolean> | undefined;
  private finishDrain: ((finished: boolean) => void) | undefined;

  get isAccepting(): boolean { return this.accepting; }
  get inFlight(): number { return this.active; }
  stopAccepting(): void { this.accepting = false; }

  async run<T>(operation: () => Promise<T>): Promise<T | undefined> {
    if (!this.accepting) return undefined;
    this.active++;
    try { return await operation(); }
    finally {
      this.active--;
      if (this.active === 0) this.finishDrain?.(true);
    }
  }

  cancelDrain(): void { this.finishDrain?.(false); }

  drain(timeoutMs: number): Promise<boolean> {
    this.stopAccepting();
    if (this.active === 0) return Promise.resolve(true);
    if (this.draining) return this.draining;
    this.draining = new Promise(resolve => {
      const timer = setTimeout(() => this.finishDrain?.(false), timeoutMs);
      this.finishDrain = finished => {
        clearTimeout(timer);
        this.finishDrain = undefined;
        resolve(finished);
      };
    });
    return this.draining;
  }
}
export const botWork = new BotWorkTracker();

/** Handler failures are contained jobs, not unknown process-level failures. */
export function dispatchBotWork(operation: () => Promise<unknown>): void {
  if (!botWork.isAccepting) return;
  const finish = startObservation("job.bot-event", "job");
  void botWork.run(operation).then(() => finish("success"), error => {
    finish("failure", error);
    try { createLogger("bot").error("Bot event failed", { code: classifyError(error, "job") }); } catch { /* Best effort. */ }
  });
}
