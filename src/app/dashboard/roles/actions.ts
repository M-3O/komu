"use server";

import { ProgressionMetric } from "@prisma/client";
import { refresh } from "next/cache";

import { requireGuild } from "@/lib/dashboard/require-guild";
import { prisma } from "@/lib/db";
import { listGuildRoles } from "@/lib/discord/rest";
import { createLogger } from "@/lib/logger";
import { SUPPORTED_METRICS, UNAVAILABLE_METRICS } from "@/lib/roles/evaluate-rules";
import { INPUT_LIMITS } from "@/lib/validation/limits";

/**
 * Role rule CRUD.
 *
 * Role ids come from the browser, so the chosen role is checked against the
 * guild's real role list before it is saved. Otherwise a tampered form could
 * point a rule at a role Komu should not manage (PRD section 11).
 */

const log = createLogger("bot");

export interface RoleFormState {
  ok?: boolean;
  error?: string;
}

// The initial state lives with the form that uses it, in RoleRuleManager. A
// "use server" file may only export async functions, and exporting a plain
// object from one throws in the browser when the form imports it.

function isSupportedMetric(value: string): value is ProgressionMetric {
  return SUPPORTED_METRICS.includes(value as ProgressionMetric);
}

export async function createRoleRuleAction(
  _previous: RoleFormState,
  formData: FormData,
): Promise<RoleFormState> {
  const guild = await requireGuild("/dashboard/roles");

  const name = String(formData.get("name") ?? "").trim();
  const metric = String(formData.get("metric") ?? "");
  const thresholdRaw = String(formData.get("threshold") ?? "");
  const roleId = String(formData.get("roleId") ?? "");

  if (!name) return { ok: false, error: "Give the rule a name." };
  if (name.length > INPUT_LIMITS.name) {
    return {
      ok: false,
      error: `Name must be ${INPUT_LIMITS.name} characters or fewer.`,
    };
  }
  if (!isSupportedMetric(metric)) {
    return {
      ok: false,
      error: UNAVAILABLE_METRICS[metric as ProgressionMetric] ?? "That metric is not available yet.",
    };
  }
  if (!roleId) return { ok: false, error: "Choose a Discord role." };

  const threshold = Number.parseInt(thresholdRaw, 10);

  if (!Number.isFinite(threshold) || threshold < 0) {
    return { ok: false, error: "Threshold must be zero or a positive number." };
  }

  if (threshold > INPUT_LIMITS.threshold) {
    return {
      ok: false,
      error: `Threshold must be ${INPUT_LIMITS.threshold.toLocaleString()} or less.`,
    };
  }

  const roles = await listGuildRoles(guild.discordId);
  const role = roles.find((candidate) => candidate.id === roleId);

  if (!role) {
    return { ok: false, error: "That role was not found in your server." };
  }

  // The @everyone pseudo-role is the whole server and is not assignable.
  if (role.id === guild.discordId) {
    return { ok: false, error: "You cannot assign the @everyone role." };
  }

  const existing = await prisma.roleRule.findFirst({
    where: { guildId: guild.id, roleId },
    select: { id: true },
  });

  if (existing) {
    return {
      ok: false,
      error: `A rule already grants @${role.name}. Edit that rule instead.`,
    };
  }

  await prisma.roleRule.create({
    data: {
      guildId: guild.id,
      name,
      metric,
      threshold,
      roleId: role.id,
      roleName: role.name,
    },
  });

  log.info("Created role rule", { guildId: guild.id, name, metric, threshold });

  refresh();

  return { ok: true };
}

export async function toggleRoleRuleAction(ruleId: string): Promise<void> {
  const guild = await requireGuild("/dashboard/roles");

  const rule = await prisma.roleRule.findFirst({
    where: { id: ruleId, guildId: guild.id },
    select: { id: true, enabled: true },
  });

  if (!rule) return;

  await prisma.roleRule.update({
    where: { id: rule.id },
    data: { enabled: !rule.enabled },
  });

  refresh();
}

export async function deleteRoleRuleAction(ruleId: string): Promise<void> {
  const guild = await requireGuild("/dashboard/roles");

  // Scoped to the guild so a guessed id cannot delete another server's rule.
  const deleted = await prisma.roleRule.deleteMany({
    where: { id: ruleId, guildId: guild.id },
  });

  if (deleted.count > 0) {
    log.info("Deleted role rule", { guildId: guild.id, ruleId });
    refresh();
  }
}