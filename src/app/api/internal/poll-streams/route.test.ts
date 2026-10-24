import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runStreamDetectionCycle } = vi.hoisted(() => ({
  runStreamDetectionCycle: vi.fn(),
}));

vi.mock("@/lib/streams/poller", () => ({ runStreamDetectionCycle }));

import * as route from "./route";

/**
 * The trigger is the only unauthenticated write path in the app: a valid
 * request posts to Discord and spends provider quota. These tests pin the
 * three things that keep it from being a weapon — POST only, header-only
 * secret, and a length floor under the secret.
 */

const SECRET = "5f".repeat(32);

const CYCLE = { checked: 0, alerted: 0, failed: [], skipped: 0, unchanged: 0 };

function request(
  headers: Record<string, string> = {},
  path = "/api/internal/poll-streams",
): Request {
  return new Request(`https://komu.test${path}`, { method: "POST", headers });
}

/** A distinct client per test keeps the per-process failure map independent. */
function from(ip: string, extra: Record<string, string> = {}): Request {
  return request({ "x-forwarded-for": ip, ...extra });
}

const originalSecret = process.env.STREAM_POLL_SECRET;

beforeEach(() => {
  process.env.STREAM_POLL_SECRET = SECRET;
  runStreamDetectionCycle.mockReset();
  runStreamDetectionCycle.mockResolvedValue(CYCLE);
});

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.STREAM_POLL_SECRET;
  } else {
    process.env.STREAM_POLL_SECRET = originalSecret;
  }
});

describe("poll trigger", () => {
  it("does not expose a GET handler", () => {
    // A `GET` export is what made the endpoint CSRF-triggerable and
    // cacheable; asserting on the namespace keeps it from coming back.
    expect("GET" in route).toBe(false);
  });

  it("refuses to run when the secret is unset", async () => {
    delete process.env.STREAM_POLL_SECRET;

    const response = await route.POST(
      from("203.0.113.10", { "x-poll-secret": SECRET }),
    );

    expect(response.status).toBe(503);
    expect(runStreamDetectionCycle).not.toHaveBeenCalled();
  });

  it("refuses a secret shorter than 32 characters", async () => {
    process.env.STREAM_POLL_SECRET = "short";

    const response = await route.POST(
      from("203.0.113.11", { "x-poll-secret": "short" }),
    );

    expect(response.status).toBe(503);
    expect(runStreamDetectionCycle).not.toHaveBeenCalled();
  });

  it("rejects a missing secret", async () => {
    const response = await route.POST(from("203.0.113.12"));

    expect(response.status).toBe(401);
    expect(runStreamDetectionCycle).not.toHaveBeenCalled();
  });

  it("rejects the secret in a query string", async () => {
    const response = await route.POST(
      request(
        { "x-forwarded-for": "203.0.113.13" },
        `/api/internal/poll-streams?secret=${SECRET}`,
      ),
    );

    expect(response.status).toBe(401);
    expect(runStreamDetectionCycle).not.toHaveBeenCalled();
  });

  it("runs the cycle when the header matches", async () => {
    const response = await route.POST(
      from("203.0.113.14", { "x-poll-secret": SECRET }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(CYCLE);
    expect(runStreamDetectionCycle).toHaveBeenCalledTimes(1);
  });

  it("locks out an address after repeated failures", async () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await route.POST(from("203.0.113.15"));
      expect(response.status).toBe(401);
    }

    const blocked = await route.POST(
      from("203.0.113.15", { "x-poll-secret": SECRET }),
    );

    expect(blocked.status).toBe(429);
    expect(runStreamDetectionCycle).not.toHaveBeenCalled();
  });
});
