import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exchange: vi.fn(), fetchUser: vi.fn(), fetchGuilds: vi.fn(), findGuilds: vi.fn(),
  update: vi.fn(), create: vi.fn(), upsert: vi.fn(), createSession: vi.fn(), destroySession: vi.fn(),
  encrypt: vi.fn(), getCookie: vi.fn(), setCookie: vi.fn(), log: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: {
  guild: { findMany: mocks.findGuilds },
  discordAccount: { update: mocks.update, create: mocks.create, upsert: mocks.upsert },
} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.getCookie, set: mocks.setCookie }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string): never => { throw new Error("REDIRECT:" + url); } }));
vi.mock("@/lib/auth/session", () => ({ createSession: mocks.createSession, destroySession: mocks.destroySession,
  OAUTH_STATE_COOKIE_NAME: "test-oauth-state" }));
vi.mock("@/lib/auth/discord-oauth", () => ({ exchangeCodeForToken: mocks.exchange,
  fetchDiscordUser: mocks.fetchUser, fetchDiscordGuilds: mocks.fetchGuilds }));
vi.mock("@/lib/auth/token-crypto", () => ({ encryptToken: mocks.encrypt }));
vi.mock("@/lib/logger", () => ({ createLogger: () => ({ info: mocks.log, warn: mocks.log, error: mocks.log }) }));
import { GET } from "./route";

let sequence = 0;
function request(query = "code=test-code&state=test-state") {
  return new Request("https://komu.test/callback?" + query, { headers: { "x-forwarded-for": "unit-client-" + ++sequence } });
}
function installation() { return { id: "installation", discordId: "connected-guild", ownerId: "owner-user",
  owner: { id: "owner-user", discordAccount: { userId: "owner-user", discordId: "owner-discord" } } }; }
function state(returnTo = "/dashboard/challenges") {
  return { value: Buffer.from(JSON.stringify({ state: "test-state", codeVerifier: "test-verifier", returnTo })).toString("base64url") };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.exchange.mockResolvedValue({ access_token: "TEST_OAUTH_CANARY", expires_in: 3600 });
  mocks.fetchUser.mockResolvedValue({ id: "owner-discord", username: "owner", avatar: null });
  mocks.fetchGuilds.mockResolvedValue([{ id: "connected-guild", owner: false, permissions: "8" }]);
  mocks.findGuilds.mockResolvedValue([installation()]);
  mocks.update.mockResolvedValue({ userId: "owner-user", discordId: "owner-discord", user: { sessionVersion: 7 } });
  mocks.getCookie.mockReturnValue(state()); mocks.encrypt.mockReturnValue("encrypted-test-token");
});

describe("owner-only OAuth callback API", () => {
  it("preserves owner login, PKCE, encrypted persistence and current session version", async () => {
    await expect(GET(request())).rejects.toThrow("REDIRECT:/dashboard/challenges");
    expect(mocks.exchange).toHaveBeenCalledWith("test-code", "test-verifier");
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: { discordId: "owner-discord", userId: "owner-user" },
      data: expect.objectContaining({ accessToken: "encrypted-test-token" }) }));
    expect(mocks.createSession).toHaveBeenCalledWith({ userId: "owner-user", discordId: "owner-discord", sessionVersion: 7 });
    expect(mocks.findGuilds.mock.invocationCallOrder[0]).toBeLessThan(mocks.update.mock.invocationCallOrder[0]);
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(mocks.createSession.mock.invocationCallOrder[0]);
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it.each(["administrator", "other-guild-owner", "member"])("rejects a direct callback for %s before any persistence", async discordId => {
    mocks.fetchUser.mockResolvedValue({ id: discordId, username: "non-owner", avatar: null });
    await expect(GET(request())).rejects.toThrow("REDIRECT:/login?error=access_denied");
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled(); expect(mocks.encrypt).not.toHaveBeenCalled();
    expect(mocks.fetchGuilds).not.toHaveBeenCalled(); expect(mocks.destroySession).toHaveBeenCalledOnce();
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain(discordId);
  });
  it.each([
    ["no installation", []],
    ["missing owner", [{ ...installation(), ownerId: null }]],
    ["multiple installations", [installation(), installation()]],
    ["missing owner account", [{ ...installation(), owner: { id: "owner-user", discordAccount: null } }]],
  ])("fails closed for %s", async (_reason, rows) => {
    mocks.findGuilds.mockResolvedValue(rows);
    await expect(GET(request())).rejects.toThrow("REDIRECT:/login?error=access_denied");
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.createSession).not.toHaveBeenCalled();
  });
  it("sanitizes ownership query failures and issues no session", async () => {
    mocks.findGuilds.mockRejectedValue(new Error("PRIVATE_DB_CANARY"));
    await expect(GET(request())).rejects.toThrow("REDIRECT:/login?error=access_unavailable");
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.createSession).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("PRIVATE_DB_CANARY");
  });
  it("does not recreate an owner account removed between verification and persistence", async () => {
    mocks.update.mockRejectedValue(new Error("PRIVATE_PERSISTENCE_CANARY"));
    await expect(GET(request())).rejects.toThrow("REDIRECT:/login?error=login_failed");
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("PRIVATE_PERSISTENCE_CANARY");
  });
  it("preserves setup routing when the owner's Discord permissions need attention", async () => {
    mocks.fetchGuilds.mockResolvedValue([]);
    await expect(GET(request())).rejects.toThrow("REDIRECT:/setup");
    expect(mocks.createSession).toHaveBeenCalledOnce();
  });
  it("rejects invalid OAuth state before identity, database, or session calls", async () => {
    await expect(GET(request("code=test-code&state=wrong"))).rejects.toThrow("REDIRECT:/login?error=state_mismatch");
    expect(mocks.exchange).not.toHaveBeenCalled(); expect(mocks.findGuilds).not.toHaveBeenCalled(); expect(mocks.createSession).not.toHaveBeenCalled();
  });
  it("keeps OAuth state cookie deletion Secure and HttpOnly", async () => {
    await expect(GET(request())).rejects.toThrow("REDIRECT:/dashboard/challenges");
    expect(mocks.setCookie).toHaveBeenCalledWith(expect.objectContaining({ secure: true, httpOnly: true, path: "/", maxAge: 0 }));
  });
  it("does not allow an external post-login return URL", async () => {
    mocks.getCookie.mockReturnValue(state("//other.invalid/"));
    await expect(GET(request())).rejects.toThrow("REDIRECT:/dashboard");
  });
});
