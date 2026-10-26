import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireGuild, findFirst, update, listGuildRoles } = vi.hoisted(() => ({
  requireGuild: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  listGuildRoles: vi.fn(),
}));

vi.mock("@/lib/dashboard/require-guild", () => ({ requireGuild }));
vi.mock("@/lib/db", () => ({
  prisma: {
    roleRule: { findFirst, update },
  },
}));
vi.mock("@/lib/discord/rest", () => ({ listGuildRoles }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));

import { updateRoleRuleAction } from "./actions";

/**
 * Editing a role rule.
 *
 * The edit form is a privileged mutation even though it looks like a small
 * inline form. These tests pin the parts a browser could tamper with: the
 * rule must belong to the connected server, the target role must still exist,
 * and an edit cannot create a second rule for the same role.
 */

const GUILD = {
  id: "guild-db",
  discordId: "guild-discord",
  name: "M3K",
};

const FORM = {
  ruleId: "rule-1",
  name: "Veteran",
  metric: "XP",
  threshold: "500",
  roleId: "role-1",
};

function formData(overrides: Partial<typeof FORM> = {}): FormData {
  const data = new FormData();
  const values = { ...FORM, ...overrides };

  for (const [key, value] of Object.entries(values)) {
    data.set(key, value);
  }

  return data;
}

beforeEach(() => {
  requireGuild.mockReset().mockResolvedValue(GUILD);
  findFirst.mockReset();
  update.mockReset().mockResolvedValue({});
  listGuildRoles
    .mockReset()
    .mockResolvedValue([{ id: "role-1", name: "Veteran", position: 1 }]);
});

describe("updateRoleRuleAction", () => {
  it("updates the label, signal, threshold and role", async () => {
    findFirst
      .mockResolvedValueOnce({ id: "rule-1" })
      .mockResolvedValueOnce(null);

    await expect(updateRoleRuleAction({}, formData())).resolves.toEqual({
      ok: true,
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: "rule-1" },
      data: {
        name: "Veteran",
        metric: "XP",
        threshold: 500,
        roleId: "role-1",
        roleName: "Veteran",
      },
    });
  });

  it("refuses a rule that belongs to another server", async () => {
    findFirst.mockResolvedValueOnce(null);

    await expect(
      updateRoleRuleAction({}, formData({ ruleId: "someone-elses-rule" })),
    ).resolves.toMatchObject({ ok: false });

    expect(listGuildRoles).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses to move a rule onto a role another rule already grants", async () => {
    findFirst
      .mockResolvedValueOnce({ id: "rule-1" })
      .mockResolvedValueOnce({ id: "rule-2" });

    await expect(updateRoleRuleAction({}, formData())).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("Another rule"),
    });

    expect(update).not.toHaveBeenCalled();
  });

  it("still refuses the @everyone role on the edit path", async () => {
    findFirst.mockResolvedValueOnce({ id: "rule-1" });
    listGuildRoles.mockResolvedValueOnce([
      { id: GUILD.discordId, name: "@everyone", position: 0 },
    ]);

    await expect(
      updateRoleRuleAction(
        {},
        formData({ roleId: GUILD.discordId }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: "You cannot assign the @everyone role.",
    });

    expect(update).not.toHaveBeenCalled();
  });

  it("explains when a metric has no data source yet", async () => {
    findFirst.mockResolvedValueOnce({ id: "rule-1" });

    await expect(
      updateRoleRuleAction({}, formData({ metric: "WATCH_TIME_HOURS" })),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("Watch time is not collected"),
    });

    expect(listGuildRoles).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
