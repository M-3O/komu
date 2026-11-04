import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HealthRegistry, health } from "@/lib/monitoring/health";
const mocks = vi.hoisted(() => ({ load: vi.fn(), latest: vi.fn(), create: vi.fn(), update: vi.fn(), provider: vi.fn(), live: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { streamingAccount: { findMany: mocks.load }, stream: { findFirst: mocks.latest, create: mocks.create, update: mocks.update } } }));
vi.mock("./registry", () => ({ getStreamingProvider: mocks.provider }));
vi.mock("@/lib/discord/rest", () => ({ sendChannelMessage: mocks.send }));
vi.mock("./build-alert-message", () => ({ buildAlertMessage: () => ({ content: "unit-alert", allowedMentions: { parse: [] } }) }));
vi.mock("@/lib/logger", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
import { runStreamDetectionCycle } from "./poller";
let registry: HealthRegistry;
const channel = { id: "account", guildId: "guild", provider: "TWITCH", providerUserId: "provider-user", username: "user", displayName: null, alertConfig: { channelId: "destination" } };
beforeEach(() => {
  vi.resetAllMocks(); registry = new HealthRegistry();
  vi.spyOn(health, "begin").mockImplementation(registry.begin.bind(registry));
  mocks.load.mockResolvedValue([channel]); mocks.latest.mockResolvedValue(null);
  mocks.create.mockResolvedValue({ id: "session" }); mocks.update.mockResolvedValue({});
  mocks.provider.mockReturnValue({ getLiveStream: mocks.live });
  mocks.live.mockResolvedValue({ provider: "TWITCH", providerStreamId: "stream", startedAt: new Date() });
  mocks.send.mockResolvedValue({ ok: true, messageId: "message" });
});
afterEach(() => vi.restoreAllMocks());

describe("accurate stream outcomes with unchanged delivery policy", () => {
  it("counts successful delivery once", async () => {
    expect(await runStreamDetectionCycle()).toMatchObject({ checked: 1, alerted: 1, failed: [], unchanged: 0 });
    expect(mocks.send).toHaveBeenCalledTimes(1); expect(mocks.update).toHaveBeenCalledTimes(1);
  });
  it("reports a provider failure separately from intentional skips and offline status", async () => {
    mocks.live.mockRejectedValue({ code: "TIMEOUT", message: "postgresql://secret" });
    expect(await runStreamDetectionCycle()).toMatchObject({ skipped: 0, unchanged: 0, failed: [{ channel: "TWITCH", reason: "PROVIDER_TIMEOUT" }] });
    expect(mocks.create).not.toHaveBeenCalled();
    mocks.provider.mockReturnValue(null);
    expect(await runStreamDetectionCycle()).toMatchObject({ skipped: 1, failed: [] });
    mocks.provider.mockReturnValue({ getLiveStream: mocks.live }); mocks.live.mockResolvedValue(null);
    expect(await runStreamDetectionCycle()).toMatchObject({ unchanged: 1, failed: [] });
  });
  it("reports refused Discord delivery without pretending nothing changed", async () => {
    mocks.send.mockResolvedValue({ ok: false, code: "DISCORD_50013", error: "secret" });
    expect(await runStreamDetectionCycle()).toMatchObject({ alerted: 0, unchanged: 0, skipped: 0, failed: [{ channel: "TWITCH", reason: "DISCORD_PERMISSION_DENIED" }] });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it("does not add a retry for the existing session after failed delivery", async () => {
    mocks.send.mockResolvedValue({ ok: false, code: "NETWORK" });
    await runStreamDetectionCycle();
    mocks.latest.mockResolvedValue({ providerStreamId: "stream", alertSentAt: null, endedAt: null });
    mocks.create.mockRejectedValue({ code: "P2002" });
    expect(await runStreamDetectionCycle()).toMatchObject({ unchanged: 1, alerted: 0 });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it("reports accepted-but-unrecorded delivery without resending", async () => {
    mocks.update.mockRejectedValue({ code: "P1001", message: "secret" });
    expect(await runStreamDetectionCycle()).toMatchObject({ alerted: 0, unchanged: 0, failed: [{ channel: "TWITCH", reason: "STREAM_DELIVERY_RECORD_FAILED" }] });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(registry.snapshot().find(s => s.component === "database.stream-delivery")).toMatchObject({ state: "degraded", lastError: "DATABASE_UNREACHABLE" });
  });
  it("reports channel database errors without storing raw errors", async () => {
    mocks.latest.mockRejectedValue({ code: "P2024", message: "secret" });
    const result = await runStreamDetectionCycle();
    expect(result).toMatchObject({ skipped: 0, unchanged: 0, failed: [{ channel: "TWITCH", reason: "DATABASE_POOL_TIMEOUT" }] });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("reports session-close failure while retaining its existing swallowed-error behavior", async () => {
    mocks.live.mockResolvedValue(null);
    mocks.latest.mockResolvedValue({ providerStreamId: "stream", alertSentAt: new Date(), endedAt: null });
    mocks.update.mockRejectedValue({ code: "P1001" });
    expect(await runStreamDetectionCycle()).toMatchObject({ unchanged: 0, failed: [{ reason: "DATABASE_REQUEST_FAILED", channel: "TWITCH" }] });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("retains the original rejection when loading channels fails", async () => {
    const error = { code: "P1001" }; mocks.load.mockRejectedValue(error);
    await expect(runStreamDetectionCycle()).rejects.toBe(error);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});


it("reports a thrown Discord response error as delivery failure rather than database failure", async () => {
  mocks.send.mockRejectedValue(new SyntaxError("canary-secret"));
  expect(await runStreamDetectionCycle()).toMatchObject({ alerted: 0, unchanged: 0,
    failed: [{ channel: "TWITCH", reason: "DISCORD_REQUEST_FAILED" }] });
  expect(mocks.send).toHaveBeenCalledTimes(1); expect(mocks.update).not.toHaveBeenCalled();
});
