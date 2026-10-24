"use server";

import { AchievementType } from "@prisma/client";
import { refresh } from "next/cache";

import {
  AVAILABLE_ACHIEVEMENT_TYPES,
  UNAVAILABLE_ACHIEVEMENT_TYPES,
} from "@/lib/achievements/evaluate";
import { requireGuild } from "@/lib/dashboard/require-guild";
import { prisma } from "@/lib/db";
import { listGuildRoles } from "@/lib/discord/rest";
import { createLogger } from "@/lib/logger";
import { INPUT_LIMITS } from "@/lib/validation/limits";

/**
 * Achievement CRUD (PRD section 7.10).
 *
 * Types are predefined, per the V1 simplicity rule in the PRD. The chosen role
 * is checked against the guild's real roles before being saved, because the
 * browser supplies it.
 */

const log = createLogger("bot");

export interface AchievementFormState {
  ok?: boolean;
  error?: string;
}

// The initial state lives with the form that uses it, in
// AchievementManager. A "use server" file may only export async functions,
// and exporting a plain object from one throws in the browser when the form
// imports it.

function isAvailableType(value: string): value is AchievementType {
  return (AVAILABLE_ACHIEVEMENT_TYPES as string[]).includes(value);
}

export async function createAchievementAction(
  _previous: AchievementFormState,
  formData: FormData,
): Promise<AchievementFormState> {
  const guild = await requireGuild("/dashboard/achievements");

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const icon = String(formData.get("icon") ?? "").trim();
  const type = String(formData.get("type") ?? "");
  const thresholdRaw = String(formData.get("threshold") ?? "");
  const xpRewardRaw = String(formData.get("xpReward") ?? "");
  const roleId = String(formData.get("roleId") ?? "");
  const hidden = formData.get("hidden") === "on";

  if (!name) return { ok: false, error: "Give the achievement a name." };
  if (name.length > INPUT_LIMITS.name) {
    return {
      ok: false,
      error: `Name must be ${INPUT_LIMITS.name} characters or fewer.`,
    };
  }

  if (!description) {
    return { ok: false, error: "Give the achievement a description." };
  }
  if (description.length > INPUT_LIMITS.description) {
    return {
      ok: false,
      error: `Description must be ${INPUT_LIMITS.description} characters or fewer.`,
    };
  }

  // The icon is shown next to the name, and is often the only thing a member
  // sees, so an empty one would look broken rather than plain.
  if (!icon) return { ok: false, error: "Choose an icon (an emoji works well)." };
  if (icon.length > INPUT_LIMITS.icon) {
    return {
      ok: false,
      error: `Icon must be ${INPUT_LIMITS.icon} characters or fewer.`,
    };
  }

  if (!isAvailableType(type)) {
    return {
      ok: false,
      error:
        UNAVAILABLE_ACHIEVEMENT_TYPES[type as AchievementType] ??
        "That achievement type is not available yet.",
    };
  }

  const threshold = Number.parseInt(thresholdRaw, 10);

  if (!Number.isFinite(threshold) || threshold <= 0) {
    return { ok: false, error: "Threshold must be at least 1." };
  }

  if (threshold > INPUT_LIMITS.threshold) {
    return {
      ok: false,
      error: `Threshold must be ${INPUT_LIMITS.threshold.toLocaleString()} or less.`,
    };
  }

  const xpReward = xpRewardRaw ? Number.parseInt(xpRewardRaw, 10) : 0;

  if (!Number.isFinite(xpReward) || xpReward < 0) {
    return { ok: false, error: "XP reward must be zero or a positive number." };
  }

  if (xpReward > INPUT_LIMITS.xpAmount) {
    return {
      ok: false,
      error: `XP reward must be ${INPUT_LIMITS.xpAmount.toLocaleString()} or less.`,
    };
  }

  let rewardRole: { id: string; name: string } | null = null;

  if (roleId) {
    const roles = await listGuildRoles(guild.discordId);
    const role = roles.find((candidate) => candidate.id === roleId);

    if (!role) {
      return { ok: false, error: "That role was not found in your server." };
    }

    if (role.id === guild.discordId) {
      return { ok: false, error: "You cannot use the @everyone role." };
    }

    rewardRole = { id: role.id, name: role.name };
  }

  await prisma.achievement.create({
    data: {
      guildId: guild.id,
      name,
      description,
      icon,
      type,
      threshold,
      xpReward,
      hidden,
      roleId: rewardRole?.id ?? null,
      roleName: rewardRole?.name ?? null,
    },
  });

  log.info("Created achievement", { guildId: guild.id, name, type, threshold, hidden });

  refresh();

  return { ok: true };
}

export async function toggleAchievementAction(achievementId: string): Promise<void> {
  const guild = await requireGuild("/dashboard/achievements");

  const achievement = await prisma.achievement.findFirst({
    where: { id: achievementId, guildId: guild.id },
    select: { id: true, enabled: true },
  });

  if (!achievement) return;

  await prisma.achievement.update({
    where: { id: achievement.id },
    data: { enabled: !achievement.enabled },
  });

  refresh();
}

export async function deleteAchievementAction(achievementId: string): Promise<void> {
  const guild = await requireGuild("/dashboard/achievements");

  // Unlocks cascade from the achievement.
  const deleted = await prisma.achievement.deleteMany({
    where: { id: achievementId, guildId: guild.id },
  });

  if (deleted.count > 0) {
    log.info("Deleted achievement", { guildId: guild.id, achievementId });
    refresh();
  }
}