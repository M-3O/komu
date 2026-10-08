"use server";

import { ChallengeRequirementType } from "@prisma/client";

import { requireCurrentUser } from "@/lib/auth/current-user";
import {
  AVAILABLE_REQUIREMENT_TYPES,
  UNAVAILABLE_REQUIREMENT_TYPES,
} from "@/lib/challenges/progress";
import { prisma } from "@/lib/db";
import { listGuildRoles } from "@/lib/discord/rest";
import { createLogger } from "@/lib/logger";

/**
 * Challenge CRUD (PRD section 7.9).
 *
 * A challenge has one or more requirements, all of which must be met. The
 * chosen role id is checked against the guild's real roles before being
 * saved, for the same reason reward actions are: the browser supplies it.
 */

const log = createLogger("bot");

export interface ChallengeFormState {
  ok?: boolean;
  error?: string;
}

export const INITIAL_CHALLENGE_STATE: ChallengeFormState = {};

async function requireGuild() {
  await requireCurrentUser("/dashboard/challenges");

  const guild = await prisma.guild.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, discordId: true },
  });

  if (!guild) throw new Error("No Discord server is connected yet.");

  return guild;
}

function isAvailableType(value: string): value is ChallengeRequirementType {
  return (AVAILABLE_REQUIREMENT_TYPES as string[]).includes(value);
}

/**
 * Create a challenge from the submitted requirement rows.
 *
 * The form sends one row per requirement, so a creator can add "attend 3
 * streams and send 20 messages" as a single challenge rather than two
 * unrelated goals.
 */
export async function createChallengeAction(
  _previous: ChallengeFormState,
  formData: FormData,
): Promise<ChallengeFormState> {
  const guild = await requireGuild();

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const endsAtRaw = String(formData.get("endsAt") ?? "").trim();
  const xpRewardRaw = String(formData.get("xpReward") ?? "").trim();
  const roleId = String(formData.get("roleId") ?? "");

  if (!name) return { ok: false, error: "Give the challenge a name." };

  // Every field named `type` is one requirement row. FormData preserves the
  // order they were submitted in, so the rows stay together.
  const types = formData.getAll("type").map(String);
  const thresholds = formData.getAll("threshold").map(String);
  const labels = formData.getAll("label").map(String);

  if (types.length === 0) {
    return { ok: false, error: "A challenge needs at least one requirement." };
  }

  const requirements: Array<{
    type: ChallengeRequirementType;
    threshold: number;
    label: string | null;
  }> = [];

  for (const [index, rawType] of types.entries()) {
    const threshold = Number.parseInt(thresholds[index] ?? "", 10);

    if (!isAvailableType(rawType)) {
      return {
        ok: false,
        error:
          UNAVAILABLE_REQUIREMENT_TYPES[rawType as ChallengeRequirementType] ??
          "That requirement is not available yet.",
      };
    }

    if (!Number.isFinite(threshold) || threshold <= 0) {
      return {
        ok: false,
        error: `Requirement ${index + 1} needs a threshold of at least 1.`,
      };
    }

    requirements.push({
      type: rawType,
      threshold,
      label: labels[index]?.trim() || null,
    });
  }

  const xpReward = xpRewardRaw ? Number.parseInt(xpRewardRaw, 10) : 0;

  if (!Number.isFinite(xpReward) || xpReward < 0) {
    return { ok: false, error: "XP reward must be zero or a positive number." };
  }

  let endsAt: Date | null = null;

  if (endsAtRaw) {
    // `datetime-local` has no timezone, so it is read as local time by
    // `new Date` on the string, which is what a creator expects.
    endsAt = new Date(endsAtRaw);

    if (Number.isNaN(endsAt.getTime())) {
      return { ok: false, error: "That end date could not be read." };
    }

    if (endsAt.getTime() <= Date.now()) {
      return {
        ok: false,
        error: "The end date is in the past. Pick a future date, or leave it empty to run until you stop it.",
      };
    }
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

  await prisma.challenge.create({
    data: {
      guildId: guild.id,
      name,
      description: description || null,
      endsAt,
      xpReward,
      rewardRoleId: rewardRole?.id ?? null,
      rewardRoleName: rewardRole?.name ?? null,
      requirements: { create: requirements },
    },
  });

  log.info("Created challenge", {
    guildId: guild.id,
    name,
    requirements: requirements.length,
  });

  return { ok: true };
}

export async function toggleChallengeAction(challengeId: string): Promise<void> {
  const guild = await requireGuild();

  const challenge = await prisma.challenge.findFirst({
    where: { id: challengeId, guildId: guild.id },
    select: { id: true, enabled: true },
  });

  if (!challenge) return;

  await prisma.challenge.update({
    where: { id: challenge.id },
    data: { enabled: !challenge.enabled },
  });
}

export async function deleteChallengeAction(challengeId: string): Promise<void> {
  const guild = await requireGuild();

  // Scoped to the guild so a guessed id cannot delete another server's
  // challenge. Requirements and progress cascade from the challenge.
  const deleted = await prisma.challenge.deleteMany({
    where: { id: challengeId, guildId: guild.id },
  });

  if (deleted.count > 0) {
    log.info("Deleted challenge", { guildId: guild.id, challengeId });
  }
}