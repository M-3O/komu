import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getStreamPollerStatus } = vi.hoisted(() => ({
  getStreamPollerStatus: vi.fn(),
}));

vi.mock("@/lib/streams/poller-runtime", () => ({ getStreamPollerStatus }));

import * as route from "./route";

/**
 * The health endpoint must be read-only and protected by the same secret as
 * the trigger. It is used to prove the in-process timers started in a hosted
 * deployment, so an unauthenticated response would leak scheduling state.
 */

const SECRET = "ab".repeat(32);

const POLLERS = [
  {
    key: "fast",
    intervalMs: 60_000,
    providers: ["TWITCH", "KICK"],
    inFlight: false,
    registeredAt: "2026-01-01T00:00:00.000Z",
    lastStartedAt: "2026-01-01T00:01:00.000Z",
    lastFinishedAt: "2026-01-01T00:01:01.000Z",
    lastResult: {
      checked: 2,
      alerted: 0,
      failed: [],
      skipped: 0,
      unchanged: 2,
    },
    lastError: null,
  },
];

function request(
  headers: Record<string, string> = {},
  path = "/api/internal/stream-status",
): Request {
  return new Request(`https://komu.test${path}`, { method: "GET", headers });
}

const originalSecret = process.env.STREAM_POLL_SECRET;

beforeEach(() => {
  process.env.STREAM_POLL_SECRET = SECRET;
  getStreamPollerStatus.mockReset();
  getStreamPollerStatus.mockReturnValue(POLLERS);
});

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.STREAM_POLL_SECRET;
  } else {
    process.env.STREAM_POLL_SECRET = originalSecret;
  }
});

describe("stream status", () => {
  it("does not expose a POST handler", () => {
    expect("POST" in route).toBe(false);
  });

  it("refuses to report when the secret is unset", async () => {
    delete process.env.STREAM_POLL_SECRET;

    const response = await route.GET(
      request({ "x-poll-secret": SECRET }),
    );

    expect(response.status).toBe(503);
    expect(getStreamPollerStatus).not.toHaveBeenCalled();
  });

  it("refuses a secret shorter than 32 characters", async () => {
    process.env.STREAM_POLL_SECRET = "short";

    const response = await route.GET(
      request({ "x-poll-secret": "short" }),
    );

    expect(response.status).toBe(503);
    expect(getStreamPollerStatus).not.toHaveBeenCalled();
  });

  it("rejects a missing secret", async () => {
    const response = await route.GET(request());

    expect(response.status).toBe(401);
    expect(getStreamPollerStatus).not.toHaveBeenCalled();
  });

  it("rejects the secret in a query string", async () => {
    const response = await route.GET(
      request({}, `/api/internal/stream-status?secret=${SECRET}`),
    );

    expect(response.status).toBe(401);
    expect(getStreamPollerStatus).not.toHaveBeenCalled();
  });

  it("returns timer state without starting a cycle", async () => {
    const response = await route.GET(
      request({ "x-poll-secret": SECRET }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      generatedAt: expect.any(String),
      activePollers: 1,
      pollers: POLLERS,
    });
    expect(getStreamPollerStatus).toHaveBeenCalledTimes(1);
  });
});
