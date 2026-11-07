import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), requireSession: vi.fn(), findAccount: vi.fn(), findGuilds: vi.fn(),
  updateGuild: vi.fn(), writeXp: vi.fn(), challengeLookup: vi.fn(),
  fetchGuilds: vi.fn(), endSession: vi.fn(), destroySession: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: {
  discordAccount: { findUnique: mocks.findAccount, findFirst: vi.fn().mockResolvedValue({ accessToken: "encrypted" }) },
  guild: { findMany: mocks.findGuilds, updateMany: mocks.updateGuild, update: mocks.writeXp },
  challenge: { findFirst: mocks.challengeLookup },
} }));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.session, requireSession: mocks.requireSession,
  destroySession: mocks.destroySession, LOGIN_PATH: "/login" }));
vi.mock("next/navigation", () => ({ redirect: (url: string): never => { throw new Error("REDIRECT:" + url); } }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/lib/auth/discord-oauth", () => ({ fetchDiscordGuilds: mocks.fetchGuilds }));
vi.mock("@/lib/auth/token-crypto", () => ({ decryptToken: () => "decrypted" }));
vi.mock("@/lib/auth/end-session", () => ({ endSession: mocks.endSession }));

import { getCurrentUser, requireCurrentUser } from "./current-user";
import { resolveDashboardGuild } from "@/lib/dashboard/require-guild";
import { updateXpSettingsAction } from "@/app/dashboard/xp/actions";
import { updateChallengeAnnouncementAction } from "@/app/dashboard/challenges/actions";
import { connectGuildAction } from "@/app/setup/actions";
import { getDashboardStats } from "@/lib/dashboard/get-dashboard-stats";
import { getSetupChecklist } from "@/lib/dashboard/setup-checklist";
import { getAnalytics, getAnalyticsTrend } from "@/lib/analytics/queries";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { POST as logout } from "@/app/(auth)/logout/route";

function installation() { return { id: "installation", discordId: "connected-guild", ownerId: "owner-user",
  owner: { id: "owner-user", discordAccount: { userId: "owner-user", discordId: "owner-discord" } } }; }
function login(userId = "owner-user", discordId = "owner-discord") {
  const payload = { userId, discordId, sessionVersion: 3, exp: 9999999999 };
  mocks.session.mockResolvedValue(payload); mocks.requireSession.mockResolvedValue(payload);
  mocks.findAccount.mockResolvedValue({ userId, discordId, username: "private-name", avatarHash: null, user: { sessionVersion: 3 } });
}
beforeEach(() => {
  vi.clearAllMocks(); login(); mocks.findGuilds.mockReset().mockResolvedValue([installation()]);
  mocks.findAccount.mockClear(); mocks.updateGuild.mockReset().mockResolvedValue({ count: 1 });
  mocks.fetchGuilds.mockReset().mockResolvedValue([{ id: "requested-guild", name: "Guild", icon: null, owner: false, permissions: "8" }]);
});

describe("owner policy at real reader/action boundaries", () => {
  it("returns the valid, linked installation owner", async () => {
    await expect(requireCurrentUser()).resolves.toMatchObject({ userId: "owner-user" });
  });
  it.each(["administrator", "other-guild-owner", "member"])("denies an existing signed-in %s", async discordId => {
    login("other-user", discordId);
    await expect(requireCurrentUser()).rejects.toThrow("REDIRECT:/login?error=access_denied");
    expect(mocks.fetchGuilds).not.toHaveBeenCalled();
  });
  it("honors revoked sessions before checking ownership", async () => {
    mocks.findAccount.mockResolvedValue({ userId: "owner-user", user: { sessionVersion: 4 } });
    await expect(requireCurrentUser()).rejects.toThrow("REDIRECT:/login");
    expect(mocks.findGuilds).not.toHaveBeenCalled();
  });
  it("rejects a signed session whose linked account user differs", async () => {
    mocks.findAccount.mockResolvedValue({ userId: "wrong-user", user: { sessionVersion: 3 } });
    await expect(getCurrentUser()).resolves.toBeNull();
  });
  it("preserves anonymous login redirection", async () => {
    mocks.requireSession.mockRejectedValue(new Error("REDIRECT:/login?returnTo=%2Fdashboard"));
    await expect(requireCurrentUser("/dashboard")).rejects.toThrow("REDIRECT:/login?returnTo=%2Fdashboard");
    expect(mocks.findAccount).not.toHaveBeenCalled();
  });
  it.each(["account lookup", "owner lookup"])("sanitizes a failed %s", async point => {
    (point === "account lookup" ? mocks.findAccount : mocks.findGuilds).mockRejectedValue(new Error("PRIVATE_DATABASE_CANARY"));
    await expect(requireCurrentUser()).rejects.toThrow("REDIRECT:/login?error=access_unavailable");
  });
  it("denies the layout's shared resolver before resolving dashboard data", async () => {
    login("other-user", "administrator");
    await expect(resolveDashboardGuild("/dashboard")).rejects.toThrow("REDIRECT:/login?error=access_denied");
  });
  it("blocks dashboard data readers and the separately streamed header", async () => {
    login("other-user", "administrator");
    for (const read of [getDashboardStats, getSetupChecklist, () => getAnalytics("30D"), () => getAnalyticsTrend("30D"), DashboardHeader]) {
      await expect(read()).rejects.toThrow("REDIRECT:/login?error=access_denied");
    }
    expect(mocks.fetchGuilds).not.toHaveBeenCalled();
  });
  it("blocks direct XP and announcement Server Actions using the real shared guard", async () => {
    login("other-user", "administrator");
    await expect(updateXpSettingsAction({}, new FormData())).rejects.toThrow("REDIRECT:/login?error=access_denied");
    await expect(updateChallengeAnnouncementAction("challenge", {}, new FormData())).rejects.toThrow("REDIRECT:/login?error=access_denied");
    expect(mocks.writeXp).not.toHaveBeenCalled(); expect(mocks.challengeLookup).not.toHaveBeenCalled();
  });
  it("refuses direct setup before Discord calls or writes for an unauthorized session", async () => {
    login("other-user", "administrator");
    await expect(connectGuildAction("requested-guild")).rejects.toThrow("REDIRECT:/login?error=access_denied");
    expect(mocks.fetchGuilds).not.toHaveBeenCalled(); expect(mocks.updateGuild).not.toHaveBeenCalled();
  });
  it("updates configuration for the owner without assigning ownership", async () => {
    await expect(connectGuildAction("requested-guild")).rejects.toThrow("REDIRECT:/dashboard");
    expect(mocks.updateGuild).toHaveBeenCalledWith({ where: { id: "installation", ownerId: "owner-user", discordId: "connected-guild" },
      data: { discordId: "requested-guild", name: "Guild", iconHash: null, setupCompletedAt: expect.any(Date) } });
    expect(mocks.updateGuild.mock.calls[0][0].data).not.toHaveProperty("ownerId");
  });
  it("rejects ownership changes between authentication and setup authorization", async () => {
    mocks.findGuilds.mockResolvedValueOnce([installation()]).mockResolvedValueOnce([]);
    await expect(connectGuildAction("requested-guild")).resolves.toEqual({ error: "Your access could not be verified." });
    expect(mocks.fetchGuilds).not.toHaveBeenCalled(); expect(mocks.updateGuild).not.toHaveBeenCalled();
  });
  it("fails a setup save when the conditional ownership check no longer matches", async () => {
    mocks.updateGuild.mockResolvedValue({ count: 0 });
    await expect(connectGuildAction("requested-guild")).resolves.toEqual({ error: "Your access could not be verified." });
  });
  it.each(["Discord", "database"])("sanitizes setup %s failures", async failure => {
    (failure === "Discord" ? mocks.fetchGuilds : mocks.updateGuild).mockRejectedValue(new Error("PRIVATE_SETUP_CANARY"));
    await expect(connectGuildAction("requested-guild")).resolves.toEqual({ error: "Your access could not be verified." });
  });
  it("retains the live target-server permission check even for the installation owner", async () => {
    mocks.fetchGuilds.mockResolvedValue([]);
    await expect(connectGuildAction("requested-guild")).resolves.toEqual({ error: "Your access could not be verified." });
    expect(mocks.updateGuild).not.toHaveBeenCalled();
  });
  it("still lets a previously unauthorized account sign out via POST", async () => {
    login("other-user", "administrator");
    await expect(logout(new Request("https://komu.test/logout", { method: "POST" }))).rejects.toThrow("REDIRECT:/");
    expect(mocks.endSession).toHaveBeenCalled(); expect(mocks.destroySession).toHaveBeenCalled();
    expect(mocks.findGuilds).not.toHaveBeenCalled();
  });
});
