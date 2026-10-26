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

interface RoleRuleFields {
  name: string;
  metric: ProgressionMetric;
  threshold: number;
  role: { id: string; name: string };
}

type ParsedRoleRule =
  | { ok: true; fields: RoleRuleFields }
  | { ok: false; error: string };

/**
 * Validate everything a create or edit submitted.
 *
 * Keeping one reader means the two forms cannot drift: an edit cannot bypass
 * the @everyone check or accept a role that is not in this server just
 * because the create path is stricter.
 */
async function readRoleRuleFields(
  guild: { discordId: string },
  formData: FormData,
): Promise<ParsedRoleRule> {
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
      error:
        UNAVAILABLE_METRICS[metric as ProgressionMetric] ??
        "That metric is not available yet.",
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

  return {
    ok: true,
    fields: {
      name,
      metric,
      threshold,
      role: { id: role.id, name: role.name },
    },
  };
}

export async function createRoleRuleAction(
  _previous: RoleFormState,
  formData: FormData,
): Promise<RoleFormState> {
  const guild = await requireGuild("/dashboard/roles");
  const parsed = await readRoleRuleFields(guild, formData);

  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { name, metric, threshold, role } = parsed.fields;

  const existing = await prisma.roleRule.findFirst({
    where: { guildId: guild.id, roleId: role.id },
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

/**
 * Edit a rule in place.
 *
 * Scoped to the connected server. The rule may not move to a role that
 * another rule already grants, which mirrors the create path and keeps the
 * "one rule per role" invariant true even when the browser posts a guessed
 * rule id.
 */
export async function updateRoleRuleAction(
  _previous: RoleFormState,
  formData: FormData,
): Promise<RoleFormState> {
  const guild = await requireGuild("/dashboard/roles");
  const ruleId = String(formData.get("ruleId") ?? "");

  const rule = await prisma.roleRule.findFirst({
    where: { id: ruleId, guildId: guild.id },
    select: { id: true },
  });

  if (!rule) {
    return { ok: false, error: "That rule no longer exists. Reload the page." };
  }

  const parsed = await readRoleRuleFields(guild, formData);

  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { name, metric, threshold, role } = parsed.fields;

  const duplicate = await prisma.roleRule.findFirst({
    where: {
      guildId: guild.id,
      roleId: role.id,
      NOT: { id: rule.id },
    },
    select: { id: true },
  });

  if (duplicate) {
    return {
      ok: false,
      error: `Another rule already grants @${role.name}. Choose a different role.`,
    };
  }

  await prisma.roleRule.update({
    where: { id: rule.id },
    data: {
      name,
      metric,
      threshold,
      roleId: role.id,
      // Refresh the snapshot so a Discord-side rename is reflected here.
      roleName: role.name,
    },
  });

  log.info("Updated role rule", {
    guildId: guild.id,
    ruleId: rule.id,
    name,
    metric,
    threshold,
  });

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