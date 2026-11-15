import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(), record: vi.fn(), send: vi.fn(), adapter: vi.fn(), live: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { streamingAccount: {
  findMany: mocks.load, updateMany: vi.fn().mockResolvedValue({ count: 1 }),
} } }));
vi.mock("./registry", () => ({ getStreamingProvider: mocks.adapter }));
vi.mock("./alert-delivery", () => ({
  markStaleAlertClaims: vi.fn(), recordStreamObservation: mocks.record, sendLiveAlert: mocks.send,
}));

import { runStreamDetectionCycle } from "./poller";

const account = { id: "account", provider: "TWITCH" };
const live = { providerStreamId: "stream" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.load.mockResolvedValue([account]);
  mocks.adapter.mockReturnValue({ getLiveStream: mocks.live });
  mocks.live.mockResolvedValue(live);
  mocks.record.mockResolvedValue("session");
  mocks.send.mockResolvedValue("ALERTED");
});

describe("stream detection outcomes", () => {
  it("delivers the recorded live session", async () => {
    expect(await runStreamDetectionCycle()).toMatchObject({ alerted: 1, checked: 1 });
    expect(mocks.send).toHaveBeenCalledWith("account", "session", live);
  });

  it("does not close an active session on a provider error", async () => {
    mocks.live.mockRejectedValue({ code: "TIMEOUT", message: "private" });
    expect(await runStreamDetectionCycle()).toMatchObject({
      failed: [{ channel: "TWITCH", reason: "PROVIDER_TIMEOUT" }],
    });
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("records a confirmed offline observation without sending", async () => {
    mocks.live.mockResolvedValue(null);
    expect(await runStreamDetectionCycle()).toMatchObject({ unchanged: 1, failed: [] });
    expect(mocks.record).toHaveBeenCalledWith("account", null, expect.any(Date), undefined);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each(["SKIPPED", "UNCHANGED"])("counts %s independently of failures", async (outcome) => {
    mocks.send.mockResolvedValue(outcome);
    expect(await runStreamDetectionCycle()).toMatchObject({
      alerted: 0, failed: [], skipped: Number(outcome === "SKIPPED"),
      unchanged: Number(outcome === "UNCHANGED"),
    });
  });

  it("reports the safe delivery error from the delivery service", async () => {
    mocks.send.mockResolvedValue({ code: "DISCORD_PERMISSION_DENIED" });
    expect(await runStreamDetectionCycle()).toMatchObject({
      failed: [{ channel: "TWITCH", reason: "DISCORD_PERMISSION_DENIED" }],
    });
  });

  it("preserves a failure to load the accounts", async () => {
    const failure = { code: "P1001" };
    mocks.load.mockRejectedValue(failure);
    await expect(runStreamDetectionCycle()).rejects.toBe(failure);
  });
});
