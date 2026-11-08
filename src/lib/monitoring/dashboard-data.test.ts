import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), account: vi.fn(), guilds: vi.fn(), observations: vi.fn(), pollers: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.session, requireSession: vi.fn(), LOGIN_PATH: "/login" }));
vi.mock("@/lib/db", () => ({ prisma: { discordAccount: { findUnique: mocks.account }, guild: { findMany: mocks.guilds } } }));
vi.mock("@/lib/streams/poller-runtime", () => ({ getStreamPollerStatus: mocks.pollers }));
vi.mock("./health", () => ({ health: { snapshot: mocks.observations } }));
import { getMonitoringDashboard } from "./dashboard-data";
import { GET } from "@/app/api/monitoring/route";
const request = (headers: Record<string, string> = {}) => new Request("https://komu.test/api/monitoring", { headers });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ userId: "owner-user", discordId: "owner-discord", sessionVersion: 1 });
  mocks.account.mockResolvedValue({ userId: "owner-user", discordId: "owner-discord", username: "PRIVATE_NAME", avatarHash: null, user: { sessionVersion: 1 } });
  mocks.guilds.mockResolvedValue([{ id: "PRIVATE_GUILD", discordId: "PRIVATE_GUILD", ownerId: "owner-user", owner: { id: "owner-user", discordAccount: { userId: "owner-user", discordId: "owner-discord" } } }]);
  mocks.observations.mockReturnValue([]); mocks.pollers.mockReturnValue([]);
});
describe("monitoring data and direct HTTP owner authorization", () => {
  it("serves only projected in-memory data to the verified owner without identities", async () => {
    const response = await GET(request()); expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store"); expect(response.headers.get("vary")).toBe("Cookie");
    const body = await response.text(); expect(body).not.toMatch(/owner-user|owner-discord|PRIVATE_GUILD|PRIVATE_NAME/);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
  it("rejects direct anonymous API calls without redirects or observations", async () => {
    mocks.session.mockResolvedValue(null);
    const r = await GET(request()); expect(r.status).toBe(401); expect(r.headers.get("location")).toBeNull();
    expect(mocks.observations).not.toHaveBeenCalled(); expect(mocks.pollers).not.toHaveBeenCalled();
  });
  it.each(["administrator", "other-guild-owner"])("rejects existing unauthorized %s sessions at both boundaries", async discordId => {
    mocks.session.mockResolvedValue({ userId: "other-user", discordId, sessionVersion: 1 });
    mocks.account.mockResolvedValue({ userId: "other-user", discordId, username: "PRIVATE_NAME", user: { sessionVersion: 1 } });
    expect(await getMonitoringDashboard()).toEqual({ ok: false, status: 403 });
    expect((await GET(request())).status).toBe(403); expect(mocks.observations).not.toHaveBeenCalled(); expect(mocks.pollers).not.toHaveBeenCalled();
  });
  it("honors session revocation", async () => {
    mocks.account.mockResolvedValue({ userId: "owner-user", user: { sessionVersion: 2 } });
    expect((await GET(request())).status).toBe(401); expect(mocks.observations).not.toHaveBeenCalled();
  });
  it.each([{ name: "no guild", rows: [] }, { name: "missing owner", rows: [{ ownerId: null }] }, { name: "multiple guilds", rows: [{}, {}] }])("fails closed for $name", async ({ rows }) => {
    mocks.guilds.mockResolvedValue(rows);
    expect((await GET(request())).status).toBe(403); expect(mocks.observations).not.toHaveBeenCalled();
  });
  it.each(["account", "ownership"])("sanitizes failed %s reads", async kind => {
    (kind === "account" ? mocks.account : mocks.guilds).mockRejectedValue(new Error("PRIVATE_CONNECTION_CANARY"));
    const response = await GET(request()); expect(response.status).toBe(503); expect(await response.text()).toBe('{"error":"Monitoring unavailable."}');
    expect(mocks.observations).not.toHaveBeenCalled();
  });
  it("returns Unknown for a failed observation source while retaining the independent source", async () => {
    mocks.observations.mockImplementation(() => { throw new Error("PRIVATE_MONITORING_CANARY"); });
    const result = await getMonitoringDashboard(); expect(result.ok).toBe(true);
    if (result.ok) expect(result.snapshot.components.every(c => c.state === "unknown")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_MONITORING_CANARY");
  });
  it.each([{ origin: "https://other.invalid" }, { "sec-fetch-site": "cross-site" }] as Record<string, string>[])("rejects cross-site requests before any reads", async headers => {
    expect((await GET(request(headers))).status).toBe(403); expect(mocks.session).not.toHaveBeenCalled();
  });
});
