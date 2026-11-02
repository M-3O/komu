"use server";

import { ChallengeRequirementType } from "@prisma/client";
import { refresh } from "next/cache";

import { requireGuild } from "@/lib/dashboard/require-guild";
import {
  AVAILABLE_REQUIREMENT_TYPES,
  UNAVAILABLE_REQUIREMENT_TYPES,
} from "@/lib/challenges/progress";
import { prisma } from "@/lib/db";
import {
  isTextChannelType,
  listGuildChannels,
  listGuildRoles,
} from "@/lib/discord/rest";
import { createLogger } from "@/lib/logger";
import { INPUT_LIMITS } from "@/lib/validation/limits";

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

// The initial state lives with the form that uses it, in
// ChallengeManager. A "use server" file may only export async functions,
// and exporting a plain object from one throws in the browser when the form
// imports it.

function isAvailableType(value: string): value is ChallengeRequirementType {
  return (AVAILABLE_REQUIREMENT_TYPES as string[]).includes(value);
}

type AnnouncementChannelResolution =
  | { ok: true; channelId: string | null }
  | { ok: false; error: string };

/**
 * Verify the browser-supplied channel against Discord before storing it.
 *
 * Empty means "no announcements" and is valid. A non-empty id must resolve to
 * a channel in this guild that can actually receive a text message.
 */
async function resolveAnnouncementChannel(
  guildDiscordId: string,
  rawChannelId: string,
): Promise<AnnouncementChannelResolution> {
  const channelId = rawChannelId.trim();

  if (!channelId) return { ok: true, channelId: null };

  const channels = await listGuildChannels(guildDiscordId);

  if (channels.length === 0) {
    return {
      ok: false,
      error:
        "Discord text channels could not be loaded. Check the bot's permissions and try again.",
    };
  }

  const channel = channels.find((candidate) => candidate.id === channelId);

  if (!channel) {
    return {
      ok: false,
      error:
        "That announcement channel is unavailable in this server. Refresh the page and choose another channel.",
    };
  }

  if (!isTextChannelType(channel.type)) {
    return {
      ok: false,
      error: "Choose a text channel for challenge announcements.",
    };
  }

  return { ok: true, channelId: channel.id };
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
  const guild = await requireGuild("/dashboard/challenges");

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const endsAtRaw = String(formData.get("endsAt") ?? "").trim();
  const xpRewardRaw = String(formData.get("xpReward") ?? "").trim();
  const roleId = String(formData.get("roleId") ?? "");
  const announcementChannelRaw = String(
    formData.get("announcementChannelId") ?? "",
  );

  if (!name) return { ok: false, error: "Give the challenge a name." };
  if (name.length > INPUT_LIMITS.name) {
    return {
      ok: false,
      error: `Name must be ${INPUT_LIMITS.name} characters or fewer.`,
    };
  }

  if (description.length > INPUT_LIMITS.description) {
    return {
      ok: false,
      error: `Description must be ${INPUT_LIMITS.description} characters or fewer.`,
    };
  }

  // Every field named `type` is one requirement row. FormData preserves the
  // order they were submitted in, so the rows stay together.
  const types = formData.getAll("type").map(String);
  const thresholds = formData.getAll("threshold").map(String);
  const labels = formData.getAll("label").map(String);

  if (types.length === 0) {
    return { ok: false, error: "A challenge needs at least one requirement." };
  }

  if (types.length > INPUT_LIMITS.challengeRequirements) {
    return {
      ok: false,
      error: `A challenge can have at most ${INPUT_LIMITS.challengeRequirements} requirements.`,
    };
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

    if (threshold > INPUT_LIMITS.threshold) {
      return {
        ok: false,
        error: `Requirement ${index + 1} must be ${INPUT_LIMITS.threshold.toLocaleString()} or less.`,
      };
    }

    const label = labels[index]?.trim() || null;

    if (label && label.length > INPUT_LIMITS.label) {
      return {
        ok: false,
        error: `Requirement ${index + 1} label must be ${INPUT_LIMITS.label} characters or fewer.`,
      };
    }

    requirements.push({
      type: rawType,
      threshold,
      label,
    });
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

  const announcementChannel = await resolveAnnouncementChannel(
    guild.discordId,
    announcementChannelRaw,
  );

  if (!announcementChannel.ok) {
    return { ok: false, error: announcementChannel.error };
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
      announcementChannelId: announcementChannel.channelId,
      requirements: { create: requirements },
    },
  });

  log.info("Created challenge", {
    guildId: guild.id,
    name,
    requirements: requirements.length,
    hasAnnouncementChannel: Boolean(announcementChannel.channelId),
  });

  refresh();

  return { ok: true };
}

export async function toggleChallengeAction(challengeId: string): Promise<void> {
  const guild = await requireGuild("/dashboard/challenges");

  const challenge = await prisma.challenge.findFirst({
    where: { id: challengeId, guildId: guild.id },
    select: { id: true, enabled: true },
  });

  if (!challenge) return;

  await prisma.challenge.update({
    where: { id: challenge.id },
    data: { enabled: !challenge.enabled },
  });

  refresh();
}

export async function deleteChallengeAction(challengeId: string): Promise<void> {
  const guild = await requireGuild("/dashboard/challenges");

  // Scoped to the guild so a guessed id cannot delete another server's
  // challenge. Requirements and progress cascade from the challenge.
  const deleted = await prisma.challenge.deleteMany({
    where: { id: challengeId, guildId: guild.id },
  });

  if (deleted.count > 0) {
    log.info("Deleted challenge", { guildId: guild.id, challengeId });
    refresh();
  }
}

/**
 * Change where an existing challenge announces completions.
 *
 * This is separate from creation so a challenge made before announcements
 * existed can be pointed at a channel without deleting its progress.
 */
export async function updateChallengeAnnouncementAction(
  challengeId: string,
  _previous: ChallengeFormState,
  formData: FormData,
): Promise<ChallengeFormState> {
  const guild = await requireGuild("/dashboard/challenges");

  const challenge = await prisma.challenge.findFirst({
    where: { id: challengeId, guildId: guild.id },
    select: { id: true },
  });

  if (!challenge) {
    return { ok: false, error: "That challenge was not found in your server." };
  }

  const announcementChannel = await resolveAnnouncementChannel(
    guild.discordId,
    String(formData.get("announcementChannelId") ?? ""),
  );

  if (!announcementChannel.ok) {
    return { ok: false, error: announcementChannel.error };
  }

  await prisma.challenge.update({
    where: { id: challenge.id },
    data: { announcementChannelId: announcementChannel.channelId },
  });

  log.info("Updated challenge announcement channel", {
    guildId: guild.id,
    challengeId: challenge.id,
    hasAnnouncementChannel: Boolean(announcementChannel.channelId),
  });

  refresh();

  return { ok: true };
}
