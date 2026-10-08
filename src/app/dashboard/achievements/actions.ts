"use server";

import { AchievementType } from "@prisma/client";

import {
  AVAILABLE_ACHIEVEMENT_TYPES,
  UNAVAILABLE_ACHIEVEMENT_TYPES,
} from "@/lib/achievements/evaluate";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { listGuildRoles } from "@/lib/discord/rest";
import { createLogger } from "@/lib/logger";

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

export const INITIAL_ACHIEVEMENT_STATE: AchievementFormState = {};

async function requireGuild() {
  await requireCurrentUser("/dashboard/achievements");

  const guild = await prisma.guild.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, discordId: true },
  });

  if (!guild) throw new Error("No Discord server is connected yet.");

  return guild;
}

function isAvailableType(value: string): value is AchievementType {
  return (AVAILABLE_ACHIEVEMENT_TYPES as string[]).includes(value);
}

export async function createAchievementAction(
  _previous: AchievementFormState,
  formData: FormData,
): Promise<AchievementFormState> {
  const guild = await requireGuild();

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const icon = String(formData.get("icon") ?? "").trim();
  const type = String(formData.get("type") ?? "");
  const thresholdRaw = String(formData.get("threshold") ?? "");
  const xpRewardRaw = String(formData.get("xpReward") ?? "");
  const roleId = String(formData.get("roleId") ?? "");
  const hidden = formData.get("hidden") === "on";

  if (!name) return { ok: false, error: "Give the achievement a name." };
  if (!description) {
    return { ok: false, error: "Give the achievement a description." };
  }

  // The icon is shown next to the name, and is often the only thing a member
  // sees, so an empty one would look broken rather than plain.
  if (!icon) return { ok: false, error: "Choose an icon (an emoji works well)." };

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

  const xpReward = xpRewardRaw ? Number.parseInt(xpRewardRaw, 10) : 0;

  if (!Number.isFinite(xpReward) || xpReward < 0) {
    return { ok: false, error: "XP reward must be zero or a positive number." };
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

  return { ok: true };
}

export async function toggleAchievementAction(achievementId: string): Promise<void> {
  const guild = await requireGuild();

  const achievement = await prisma.achievement.findFirst({
    where: { id: achievementId, guildId: guild.id },
    select: { id: true, enabled: true },
  });

  if (!achievement) return;

  await prisma.achievement.update({
    where: { id: achievement.id },
    data: { enabled: !achievement.enabled },
  });
}

export async function deleteAchievementAction(achievementId: string): Promise<void> {
  const guild = await requireGuild();

  // Unlocks cascade from the achievement.
  const deleted = await prisma.achievement.deleteMany({
    where: { id: achievementId, guildId: guild.id },
  });

  if (deleted.count > 0) {
    log.info("Deleted achievement", { guildId: guild.id, achievementId });
  }
}