import { describe, expect, it } from "vitest";

import { canManageGuild, manageableGuilds } from "./discord-permissions";
import type { DiscordGuildSummary } from "./discord-oauth";

const ADMINISTRATOR = (1 << 3).toString(); // 8
const VIEW_CHANNEL = (1 << 10).toString(); // 1024

function guild(overrides: Partial<DiscordGuildSummary> = {}) {
  return {
    id: "111",
    name: "Test Server",
    icon: null,
    owner: false,
    permissions: "0",
    ...overrides,
  };
}

describe("canManageGuild", () => {
  it("allows the server owner regardless of permissions", () => {
    expect(canManageGuild(guild({ owner: true, permissions: "0" }))).toBe(true);
  });

  it("allows a member with the Administrator permission", () => {
    expect(canManageGuild(guild({ permissions: ADMINISTRATOR }))).toBe(true);
  });

  it("allows Administrator alongside other bits set", () => {
    const combined = (8 | 2048 | 65536).toString();
    expect(canManageGuild(guild({ permissions: combined }))).toBe(true);
  });

  it("rejects a member without Administrator", () => {
    expect(canManageGuild(guild({ permissions: "0" }))).toBe(false);
  });

  it("rejects a member with unrelated permissions", () => {
    expect(canManageGuild(guild({ permissions: VIEW_CHANNEL }))).toBe(false);
  });

  it("rejects a non-numeric permission value", () => {
    expect(canManageGuild(guild({ permissions: "not-a-number" }))).toBe(false);
  });
});

describe("manageableGuilds", () => {
  it("keeps only guilds the user can administer", () => {
    const result = manageableGuilds([
      guild({ id: "1", owner: true }),
      guild({ id: "2", permissions: ADMINISTRATOR }),
      guild({ id: "3", permissions: "0" }),
    ]);

    expect(result.map((candidate) => candidate.id)).toEqual(["1", "2"]);
  });

  it("returns an empty list when nothing is manageable", () => {
    expect(manageableGuilds([guild({ permissions: "0" })])).toEqual([]);
  });
});