import { describe, expect, it } from "vitest";

import { clientKey, RateLimiter } from "./rate-limit";

const WINDOW_MS = 60_000;
const NOW = 1_700_000_000_000;

describe("RateLimiter", () => {
  it("allows requests up to the limit", () => {
    const limiter = new RateLimiter(3, WINDOW_MS);

    expect(limiter.consume("ip", NOW)).toEqual({
      allowed: true,
      remaining: 2,
      retryAfterSeconds: 0,
    });
    expect(limiter.consume("ip", NOW + 1).remaining).toBe(1);
    expect(limiter.consume("ip", NOW + 2).remaining).toBe(0);
  });

  it("rejects the request after the limit and reports the wait", () => {
    const limiter = new RateLimiter(2, WINDOW_MS);

    limiter.consume("ip", NOW);
    limiter.consume("ip", NOW);
    const blocked = limiter.consume("ip", NOW + 15_000);

    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBe(45);
  });

  it("starts a fresh window once the old one expires", () => {
    const limiter = new RateLimiter(1, WINDOW_MS);

    limiter.consume("ip", NOW);
    expect(limiter.consume("ip", NOW + WINDOW_MS - 1).allowed).toBe(false);

    expect(limiter.consume("ip", NOW + WINDOW_MS)).toEqual({
      allowed: true,
      remaining: 0,
      retryAfterSeconds: 0,
    });
  });

  it("tracks keys independently", () => {
    const limiter = new RateLimiter(1, WINDOW_MS);

    expect(limiter.consume("one", NOW).allowed).toBe(true);
    expect(limiter.consume("two", NOW).allowed).toBe(true);
    expect(limiter.consume("one", NOW).allowed).toBe(false);
  });
});

describe("clientKey", () => {
  it("uses the first forwarded address", () => {
    const request = new Request("http://localhost/", {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    });

    expect(clientKey(request)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip", () => {
    const request = new Request("http://localhost/", {
      headers: { "x-real-ip": "203.0.113.8" },
    });

    expect(clientKey(request)).toBe("203.0.113.8");
  });

  it("falls back to a shared key when no proxy header exists", () => {
    expect(clientKey(new Request("http://localhost/"))).toBe("local");
  });
});
