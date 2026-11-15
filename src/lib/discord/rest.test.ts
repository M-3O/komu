import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HealthRegistry, health } from "@/lib/monitoring/health";
import { findOwnAlertMessage, listGuildChannels, sendChannelMessage } from "./rest";

let registry: HealthRegistry;
const fetchMock = vi.fn();
vi.mock("@/lib/logger", () => ({ createLogger: () => ({ error: vi.fn(), warn: vi.fn() }) }));
beforeEach(() => {
  registry = new HealthRegistry();
  vi.spyOn(health, "begin").mockImplementation(registry.begin.bind(registry));
  vi.stubEnv("DISCORD_BOT_TOKEN", "unit-test-placeholder");
  vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const status = () => registry.snapshot().find(s => s.component === "discord.write")!;

describe("Discord REST monitoring without retries", () => {
  it.each([
    [401, "DISCORD_AUTH_FAILED"], [403, "DISCORD_PERMISSION_DENIED"],
    [404, "DISCORD_RESOURCE_UNAVAILABLE"], [429, "DISCORD_RATE_LIMITED"], [500, "DISCORD_REQUEST_FAILED"],
  ])("records HTTP %s safely and preserves failed delivery", async (httpStatus, code) => {
    fetchMock.mockResolvedValue(Response.json({ code: 0, message: "postgresql://secret" }, { status: httpStatus as number }));
    const result = await sendChannelMessage("unit-channel", { content: "secret-message" });
    expect(result.ok).toBe(false);
    expect(status().lastError).toBe(code);
    expect(JSON.stringify(registry.snapshot())).not.toMatch(/secret|unit-channel/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("records success without modifying the payload or allowed mentions", async () => {
    fetchMock.mockResolvedValue(Response.json({ id: "sent-message" }));
    expect(await sendChannelMessage("unit-channel", { content: "hello", allowedMentions: { parse: [], users: ["member"] } }))
      .toEqual({ ok: true, messageId: "sent-message" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ allowed_mentions: { parse: [], users: ["member"] } });
    expect(status().state).toBe("healthy");
  });
  it("a successful read cannot clear a failed send", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 403 })).mockResolvedValueOnce(Response.json([]));
    await sendChannelMessage("unit-channel", {}); await listGuildChannels("unit-guild");
    expect(status().state).toBe("degraded");
  });
  it.each([new DOMException("secret", "TimeoutError"), new TypeError("secret")])("records transport failure without resending", async error => {
    fetchMock.mockRejectedValue(error);
    expect((await sendChannelMessage("unit-channel", {})).ok).toBe(false);
    expect(status().lastError).toBe(error.name === "TimeoutError" ? "DISCORD_TIMEOUT" : "DISCORD_NETWORK");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("preserves malformed successful-response rejection identity", async () => {
    const error = new SyntaxError("secret");
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.reject(error) });
    await expect(sendChannelMessage("unit-channel", {})).rejects.toBe(error);
    expect(status().lastError).toBe("DISCORD_REQUEST_FAILED");
  });
  it("enforces the alert nonce and preserves the rate limit wait", async () => {
    fetchMock.mockResolvedValue(Response.json({ retry_after: 2.5 }, {
      status: 429, headers: { "Retry-After": "2" },
    }));
    expect(await sendChannelMessage("unit-channel", { content: "live", nonce: "alert-reference" }))
      .toMatchObject({ status: 429, retryAfterMs: 2500 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body))
      .toMatchObject({ nonce: "alert-reference", enforce_nonce: true });
  });
  it("finds only the original bot's matching message in the attempted channel", async () => {
    const timestamp = new Date();
    const body = { content: "-# Alert ref: exact-reference", timestamp: timestamp.toISOString() };
    fetchMock.mockResolvedValueOnce(Response.json({ id: "komu" })).mockResolvedValueOnce(Response.json([
      { ...body, id: "copied", author: { id: "another-bot" } },
      { ...body, id: "sent", author: { id: "komu" } },
    ]));
    expect(await findOwnAlertMessage("unit-channel", "exact-reference", timestamp))
      .toEqual({ id: "sent", postedAt: timestamp });
    expect(fetchMock.mock.calls[1][0]).toContain("/channels/unit-channel/messages");
    const before = new URL(fetchMock.mock.calls[1][0]).searchParams.get("before");
    expect(Number(BigInt(before!) >> BigInt(22)) + 1420070400000).toBe(+timestamp + 120_000);
  });
});
