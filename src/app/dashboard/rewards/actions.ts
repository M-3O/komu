"use server";

import { Prisma, ProgressionMetric, RewardActionType } from "@prisma/client";

import { requireCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { listGuildRoles } from "@/lib/discord/rest";
import { createLogger } from "@/lib/logger";
import { AVAILABLE_METRICS, UNAVAILABLE_METRICS } from "@/lib/progression/metrics";
import { CONFIGURABLE_ACTION_TYPES } from "@/lib/rewards/action-types";

/**
 * Reward CRUD (PRD section 7.8).
 *
 * A reward is a condition plus one or more actions, so this validates both
 * halves. Role and achievement ids arrive from the browser and are checked
 * against the guild's real records before being saved; otherwise a tampered
 * form could point a reward at something Komu should not touch (section 11).
 */

const log = createLogger("bot");

export interface RewardFormState {
  ok?: boolean;
  error?: string;
}

export const INITIAL_REWARD_STATE: RewardFormState = {};

async function requireGuild() {
  await requireCurrentUser("/dashboard/rewards");

  const guild = await prisma.guild.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, discordId: true },
  });

  if (!guild) throw new Error("No Discord server is connected yet.");

  return guild;
}

function isAvailableMetric(value: string): value is ProgressionMetric {
  return (AVAILABLE_METRICS as string[]).includes(value);
}

function isConfigurableAction(value: string): value is RewardActionType {
  return (CONFIGURABLE_ACTION_TYPES as string[]).includes(value);
}

/** Read a positive integer from the form, or return null. */
function parseAmount(raw: FormDataEntryValue | null): number | null {
  const parsed = Number.parseInt(String(raw ?? ""), 10);

  if (!Number.isFinite(parsed) || parsed < 0) return null;

  return parsed;
}

export async function createRewardAction(
  _previous: RewardFormState,
  formData: FormData,
): Promise<RewardFormState> {
  const guild = await requireGuild();

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const metric = String(formData.get("metric") ?? "");
  const thresholdRaw = String(formData.get("threshold") ?? "");
  const repeatable = formData.get("repeatable") === "on";

  const actionType = String(formData.get("actionType") ?? "");
  const xpAmountRaw = formData.get("xpAmount");
  const roleId = String(formData.get("roleId") ?? "");
  const achievementId = String(formData.get("achievementId") ?? "");

  if (!name) return { ok: false, error: "Give the reward a name." };

  if (!isAvailableMetric(metric)) {
    return {
      ok: false,
      error:
        UNAVAILABLE_METRICS[metric as ProgressionMetric] ??
        "That metric is not available yet.",
    };
  }

  const threshold = Number.parseInt(thresholdRaw, 10);

  if (!Number.isFinite(threshold) || threshold < 0) {
    return { ok: false, error: "Threshold must be zero or a positive number." };
  }

  if (!isConfigurableAction(actionType)) {
    return { ok: false, error: "Choose what the reward gives." };
  }

  // Each action type carries different data, so each is checked for exactly
  // what it needs before anything is written.
  const action = await buildAction({ actionType, xpAmountRaw, roleId, achievementId, guild });

  if ("error" in action) return { ok: false, error: action.error };

  await prisma.reward.create({
    data: {
      guildId: guild.id,
      name,
      description: description || null,
      conditionMetric: metric,
      conditionThreshold: threshold,
      repeatable,
      actions: { create: [action.data] },
    },
  });

  log.info("Created reward", {
    guildId: guild.id,
    name,
    metric,
    threshold,
    action: actionType,
  });

  return { ok: true };
}

type BuiltAction =
  | { data: Prisma.RewardActionCreateWithoutRewardInput }
  | { error: string };

/**
 * Validate one action row.
 *
 * Returns the data to store, or an error worth showing the creator. Kept
 * separate from the action so the same validation runs before any write.
 */
async function buildAction(input: {
  actionType: RewardActionType;
  xpAmountRaw: FormDataEntryValue | null;
  roleId: string;
  achievementId: string;
  guild: { id: string; discordId: string };
}): Promise<BuiltAction> {
  switch (input.actionType) {
    case RewardActionType.GIVE_XP: {
      const amount = parseAmount(input.xpAmountRaw);

      if (amount === null || amount === 0) {
        return { error: "Enter how much XP to give." };
      }

      return { data: { type: RewardActionType.GIVE_XP, xpAmount: amount } };
    }

    case RewardActionType.ADD_ROLE:
    case RewardActionType.REMOVE_ROLE: {
      if (!input.roleId) return { error: "Choose a Discord role." };

      const roles = await listGuildRoles(input.guild.discordId);
      const role = roles.find((candidate) => candidate.id === input.roleId);

      if (!role) {
        return { error: "That role was not found in your server." };
      }

      // @everyone is the whole server, not something to assign.
      if (role.id === input.guild.discordId) {
        return { error: "You cannot use the @everyone role." };
      }

      return {
        data: {
          type: input.actionType,
          roleId: role.id,
          roleName: role.name,
        },
      };
    }

    case RewardActionType.UNLOCK_ACHIEVEMENT: {
      if (!input.achievementId) return { error: "Choose an achievement." };

      const achievement = await prisma.achievement.findFirst({
        where: { id: input.achievementId, guildId: input.guild.id },
        select: { id: true },
      });

      if (!achievement) {
        return { error: "That achievement was not found." };
      }

      return {
        data: {
          type: RewardActionType.UNLOCK_ACHIEVEMENT,
          achievementId: achievement.id,
        },
      };
    }

    default:
      // Reachable only if a new action type is added to the enum. Not offering
      // it in the UI is the point: an action that silently does nothing is
      // worse than one the creator cannot pick.
      return { error: "That reward effect is not supported yet." };
  }
}

export async function toggleRewardAction(rewardId: string): Promise<void> {
  const guild = await requireGuild();

  const reward = await prisma.reward.findFirst({
    where: { id: rewardId, guildId: guild.id },
    select: { id: true, enabled: true },
  });

  if (!reward) return;

  await prisma.reward.update({
    where: { id: reward.id },
    data: { enabled: !reward.enabled },
  });
}

export async function deleteRewardAction(rewardId: string): Promise<void> {
  const guild = await requireGuild();

  // Scoped to the guild so a guessed id cannot delete another server's
  // reward. Actions and grants cascade from the reward.
  const deleted = await prisma.reward.deleteMany({
    where: { id: rewardId, guildId: guild.id },
  });

  if (deleted.count > 0) {
    log.info("Deleted reward", { guildId: guild.id, rewardId });
  }
}