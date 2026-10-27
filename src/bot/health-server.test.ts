import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_BOT_HEALTH_PORT,
  readBotHealthPort,
  startBotHealthServer,
  type BotHealthServer,
} from "./health-server";

/**
 * The bot needs a health endpoint because CranL's app platform expects a
 * listening port. These tests pin the two states that matter operationally:
 * 503 while Discord is still connecting, and 200 once it is ready.
 */

let health: BotHealthServer | undefined;

afterEach(async () => {
  await health?.close();
  health = undefined;
});

describe("bot health server", () => {
  it("returns 503 until Discord is ready, then 200", async () => {
    let ready = false;

    health = await startBotHealthServer({
      port: 0,
      isReady: () => ready,
      startedAt: Date.now() - 5_000,
    });

    const starting = await fetch(`http://127.0.0.1:${health.port}/health`);
    expect(starting.status).toBe(503);
    expect(starting.headers.get("cache-control")).toBe("no-store");
    expect(await starting.json()).toMatchObject({
      status: "starting",
      botReady: false,
      uptimeSeconds: expect.any(Number),
    });

    ready = true;

    const healthy = await fetch(`http://127.0.0.1:${health.port}/health`);
    expect(healthy.status).toBe(200);
    expect(await healthy.json()).toMatchObject({
      status: "ok",
      botReady: true,
    });
  });

  it("serves the same status at the root path", async () => {
    health = await startBotHealthServer({
      port: 0,
      isReady: () => true,
    });

    const response = await fetch(`http://127.0.0.1:${health.port}/`);
    expect(response.status).toBe(200);
  });

  it("rejects unknown paths and methods", async () => {
    health = await startBotHealthServer({
      port: 0,
      isReady: () => true,
    });

    const missing = await fetch(`http://127.0.0.1:${health.port}/not-health`);
    expect(missing.status).toBe(404);

    const post = await fetch(`http://127.0.0.1:${health.port}/health`, {
      method: "POST",
    });
    expect(post.status).toBe(405);
  });

  it("treats a throwing readiness check as not ready", async () => {
    health = await startBotHealthServer({
      port: 0,
      isReady: () => {
        throw new Error("not ready");
      },
    });

    const response = await fetch(`http://127.0.0.1:${health.port}/health`);
    expect(response.status).toBe(503);
  });
});

describe("bot health port", () => {
  it("uses the default when PORT is empty", () => {
    expect(readBotHealthPort("")).toBe(DEFAULT_BOT_HEALTH_PORT);
  });

  it("accepts a valid PORT", () => {
    expect(readBotHealthPort("4000")).toBe(4_000);
  });

  it("rejects invalid ports", () => {
    for (const value of ["0", "-1", "3.5", "65536", "not-a-port"]) {
      expect(() => readBotHealthPort(value)).toThrow("PORT must be");
    }
  });
});
