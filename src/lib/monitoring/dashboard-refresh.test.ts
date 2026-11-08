import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMonitoringRefresh, MonitoringRequestError, requestMonitoringSnapshot, REQUEST_TIMEOUT_MS } from "./dashboard-refresh";
import { projectDashboardSnapshot } from "./dashboard-projection";

const snapshot = () => projectDashboardSnapshot([], [], Date.now());
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function setup(request = vi.fn().mockImplementation(async () => snapshot())) {
  const onSnapshot = vi.fn(), onStatus = vi.fn(), active = vi.fn().mockReturnValue(true);
  const control = createMonitoringRefresh({ request, onSnapshot, onStatus, active, now: () => Date.now() });
  return { ...control, request, onSnapshot, onStatus, active };
}
describe("bounded monitoring refresh", () => {
  it("waits 30 seconds before automatic refresh and applies manual cooldown", async () => {
    const c = setup(); c.start(); await vi.advanceTimersByTimeAsync(29_999); expect(c.request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(c.request).toHaveBeenCalledOnce();
    await c.refresh(); expect(c.request).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10_000); expect(c.request).toHaveBeenCalledTimes(2); c.stop();
  });
  it("never overlaps manual/automatic requests", async () => {
    let resolve!: (value: ReturnType<typeof snapshot>) => void;
    const request = vi.fn().mockImplementation(() => new Promise(r => { resolve = r; }));
    const c = setup(request); const pending = c.refresh(); await c.refresh(); await c.refresh();
    expect(request).toHaveBeenCalledOnce(); resolve(snapshot()); await pending; c.stop();
  });
  it("aborts and reports Unknown availability after the request deadline", async () => {
    const request = vi.fn().mockImplementation(() => new Promise(() => {}));
    const c = setup(request); const pending = c.refresh(); await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS); await pending;
    expect(request.mock.calls[0][0].aborted).toBe(true); expect(c.onStatus).toHaveBeenLastCalledWith("unavailable"); expect(c.onSnapshot).not.toHaveBeenCalled(); c.stop();
  });
  it("backs off after failure and does not let manual clicks bypass it", async () => {
    const c = setup(vi.fn().mockRejectedValue(new Error("PRIVATE_CANARY")));
    await c.refresh(); await c.refresh(); expect(c.request).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(59_999); expect(c.request).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1); expect(c.request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(119_999); expect(c.request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect(c.request).toHaveBeenCalledTimes(3); c.stop();
  });
  it("pauses hidden/offline activity and resumes with no queued burst", async () => {
    const c = setup(); c.active.mockReturnValue(false); c.start(); await vi.advanceTimersByTimeAsync(90_000);
    expect(c.request).not.toHaveBeenCalled(); expect(c.onStatus).toHaveBeenLastCalledWith("paused");
    c.active.mockReturnValue(true); await c.refresh(); expect(c.request).toHaveBeenCalledOnce(); c.stop();
  });
  it("stops entirely on revoked authorization", async () => {
    const c = setup(vi.fn().mockRejectedValue(new MonitoringRequestError(true))); await c.refresh();
    expect(c.onStatus).toHaveBeenLastCalledWith("denied"); await vi.advanceTimersByTimeAsync(1_000_000); await c.refresh(); expect(c.request).toHaveBeenCalledOnce();
  });
  it("aborts unmounted work and ignores its eventual response", async () => {
    let resolve!: (value: ReturnType<typeof snapshot>) => void;
    const request = vi.fn().mockImplementation(() => new Promise(r => { resolve = r; }));
    const c = setup(request); const pending = c.refresh(); c.stop(); resolve(snapshot()); await pending;
    expect(request.mock.calls[0][0].aborted).toBe(true); expect(c.onSnapshot).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000); expect(request).toHaveBeenCalledOnce();
  });
});

describe("same-origin response boundary", () => {
  it("fetches no external address or secret and validates the response", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(snapshot())); vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    await expect(requestMonitoringSnapshot(signal)).resolves.toMatchObject({ scope: "dashboard-process" });
    expect(fetch).toHaveBeenCalledWith("/api/monitoring", expect.objectContaining({ signal: expect.any(AbortSignal), cache: "no-store", redirect: "error", credentials: "same-origin" }));
  });
  it.each([401, 403])("stops on HTTP %s", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("PRIVATE_CANARY", { status })));
    await expect(requestMonitoringSnapshot(new AbortController().signal)).rejects.toMatchObject({ denied: true, message: "Monitoring unavailable." });
  });
  it.each([new Response("PRIVATE_CANARY"), Response.json({ privateError: "PRIVATE_CANARY" }), new Response("{" , { headers: { "content-type": "application/json" } })])("does not surface malformed response content %#", async response => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(requestMonitoringSnapshot(new AbortController().signal)).rejects.toThrow("Monitoring unavailable.");
  });
  it("sanitizes transport rejections", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("PRIVATE_TRANSPORT_CANARY")));
    await expect(requestMonitoringSnapshot(new AbortController().signal)).rejects.toThrow("Monitoring unavailable.");
  });
  it("rejects oversized payloads without retaining or printing them", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('"' + "x".repeat(70_000) + '"', { headers: { "content-type": "application/json" } })));
    await expect(requestMonitoringSnapshot(new AbortController().signal)).rejects.toThrow("Monitoring unavailable.");
  });
});
