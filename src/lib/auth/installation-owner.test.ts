import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { guild: { findMany } } }));
import { authorizeInstallationOwner } from "./installation-owner";

function guild() {
  return {
    id: "installation", discordId: "guild-discord", ownerId: "owner-user",
    owner: { id: "owner-user", discordAccount: { userId: "owner-user", discordId: "owner-discord" } },
  };
}
const identity = { userId: "owner-user", discordId: "owner-discord" };
beforeEach(() => { findMany.mockReset().mockResolvedValue([guild()]); });

describe("installation owner authorization", () => {
  it("authorizes the existing linked owner without selecting OAuth tokens", async () => {
    expect(await authorizeInstallationOwner(identity)).toEqual({ ok: true, owner: {
      ...identity, guildId: "installation", guildDiscordId: "guild-discord",
    } });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }));
    expect(JSON.stringify(findMany.mock.calls)).not.toContain("accessToken");
  });
  it("accepts Discord-verified identity before OAuth account persistence", async () => {
    expect((await authorizeInstallationOwner({ discordId: "owner-discord" })).ok).toBe(true);
  });
  it.each(["administrator", "another-guild-owner", "member"])("denies %s without a permission fallback", async (discordId) => {
    expect(await authorizeInstallationOwner({ userId: "other-user", discordId })).toEqual({ ok: false, reason: "access_denied" });
  });
  it("rejects a mismatched dashboard user even when Discord identity matches", async () => {
    expect((await authorizeInstallationOwner({ ...identity, userId: "other-user" })).ok).toBe(false);
  });
  it.each([
    ["no installation", []],
    ["multiple guilds, even with the same owner", [guild(), { ...guild(), id: "second" }]],
    ["null owner", [{ ...guild(), ownerId: null }]],
    ["empty owner", [{ ...guild(), ownerId: "" }]],
    ["missing user", [{ ...guild(), owner: null }]],
    ["wrong user relation", [{ ...guild(), owner: { ...guild().owner, id: "wrong" } }]],
    ["missing linked account", [{ ...guild(), owner: { id: "owner-user", discordAccount: null } }]],
    ["wrong account relation", [{ ...guild(), owner: { id: "owner-user", discordAccount: { userId: "wrong", discordId: "owner-discord" } } }]],
    ["empty Discord identity", [{ ...guild(), owner: { id: "owner-user", discordAccount: { userId: "owner-user", discordId: "" } } }]],
  ])("fails closed for %s", async (_name, rows) => {
    findMany.mockResolvedValue(rows);
    expect(await authorizeInstallationOwner(identity)).toEqual({ ok: false, reason: "access_denied" });
  });
  it("sanitizes database failures without returning or logging raw errors", async () => {
    findMany.mockRejectedValue(new Error("CANARY_PRIVATE_CONNECTION_DETAILS"));
    expect(await authorizeInstallationOwner(identity)).toEqual({ ok: false, reason: "access_unavailable" });
  });
  it("does not retain a previous authorization after ownership changes", async () => {
    expect((await authorizeInstallationOwner(identity)).ok).toBe(true);
    findMany.mockResolvedValue([{ ...guild(), ownerId: null }]);
    expect((await authorizeInstallationOwner(identity)).ok).toBe(false);
  });
  it("applies equally in development, test and production", async () => {
    for (const mode of ["development", "test", "production"]) {
      vi.stubEnv("NODE_ENV", mode);
      expect((await authorizeInstallationOwner({ discordId: "administrator" })).ok).toBe(false);
    }
    vi.unstubAllEnvs();
  });
});
