"use server";

import { prisma } from "@/lib/db";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { createLogger } from "@/lib/logger";
import { validateSettings, type XpSettingsInput } from "@/lib/xp/settings";

/**
 * XP settings (PRD section 7.5).
 *
 * These were editable only in the database until now, because the sidebar
 * linked to a page that did not exist. Values are validated by the same pure
 * functions the tests cover, so the form and the XP service cannot disagree
 * about what a valid configuration is.
 */

const log = createLogger("xp");

export interface XpFormState {
  ok?: boolean;
  error?: string;
  /** Field-level messages, so the form can mark each wrong input. */
  problems?: Record<string, string>;
}

export const INITIAL_XP_STATE: XpFormState = {};

async function requireGuild() {
  await requireCurrentUser("/dashboard/xp");

  const guild = await prisma.guild.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });

  if (!guild) throw new Error("No Discord server is connected yet.");

  return guild;
}

function readInt(formData: FormData, key: string): number {
  return Number.parseInt(String(formData.get(key) ?? ""), 10);
}

export async function updateXpSettingsAction(
  _previous: XpFormState,
  formData: FormData,
): Promise<XpFormState> {
  const guild = await requireGuild();

  const input: XpSettingsInput = {
    xpEnabled: formData.get("xpEnabled") === "on",
    xpMessageAmount: readInt(formData, "xpMessageAmount"),
    xpMessageMinLength: readInt(formData, "xpMessageMinLength"),
    xpMessageCooldownSecs: readInt(formData, "xpMessageCooldownSecs"),
    xpDailyCap: readInt(formData, "xpDailyCap"),
  };

  const problems = validateSettings(input);

  if (problems.length > 0) {
    return {
      error: problems[0].message,
      problems: Object.fromEntries(problems.map((problem) => [problem.field, problem.message])),
    };
  }

  await prisma.guild.update({
    where: { id: guild.id },
    data: input,
  });

  log.info("Updated XP settings", {
    guildId: guild.id,
    enabled: input.xpEnabled,
    messageAmount: input.xpMessageAmount,
    cooldownSecs: input.xpMessageCooldownSecs,
    dailyCap: input.xpDailyCap,
  });

  return { ok: true };
}