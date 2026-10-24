/**
 * A process-local fixed-window rate limiter.
 *
 * Komu is self-hosted as a single Node process, so a Map is the right size:
 * it needs no Redis and there is no second instance to share state with. The
 * counters reset when the process restarts, which is fine for the job here —
 * stopping a burst against the auth endpoints — rather than long-term quotas.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Requests left in the current window. */
  remaining: number;
  /** Whole seconds until the window resets; 0 when the request is allowed. */
  retryAfterSeconds: number;
}

interface Window {
  count: number;
  resetAt: number;
}

/** Above this many tracked keys, expired windows are swept. */
const PRUNE_THRESHOLD = 1_000;

export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  consume(key: string, now = Date.now()): RateLimitResult {
    const existing = this.windows.get(key);

    if (!existing || existing.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      this.prune(now);

      return {
        allowed: true,
        remaining: this.limit - 1,
        retryAfterSeconds: 0,
      };
    }

    if (existing.count >= this.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((existing.resetAt - now) / 1000),
        ),
      };
    }

    existing.count += 1;

    return {
      allowed: true,
      remaining: this.limit - existing.count,
      retryAfterSeconds: 0,
    };
  }

  private prune(now: number): void {
    if (this.windows.size < PRUNE_THRESHOLD) return;

    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}

/**
 * A best-effort client key for a request.
 *
 * `x-forwarded-for` is set by whatever reverse proxy sits in front of the app;
 * the first entry is the client. Without a proxy every request shares
 * "local", which makes the limit global: acceptable for a single-creator
 * install, and safer than trusting a header that is absent anyway.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();

  return first || request.headers.get("x-real-ip")?.trim() || "local";
}
