import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";

import {
  completionPercent,
  countersFrom,
  parseStoredProgress,
  requirementLabel,
  requirementStatuses,
} from "@/lib/challenges/progress";
import { prisma } from "@/lib/db";
import { KOMU_COLOR } from "../constants";

/**
 * `/challenge` — a member's progress on the current challenges.
 *
 * The member-facing view of challenge progress (PRD section 7.9). Challenges
 * have no announcement channel configured, so this is where a member finds
 * out how they are doing rather than waiting to be told.
 */

export const challengeCommand = new SlashCommandBuilder()
  .setName("challenge")
  .setDescription("Show your progress on the current challenges.");

export async function handleChallenge(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply("This command only works inside a server.");
    return;
  }

  await interaction.deferReply();

  const guild = await prisma.guild.findFirst({
    where: { discordId: interaction.guildId! },
    select: { id: true },
  });

  if (!guild) {
    await interaction.editReply("No server is connected to this dashboard yet.");
    return;
  }

  const member = await prisma.guildMember.findFirst({
    where: { guildId: guild.id, discordId: interaction.user.id },
    select: { id: true, level: true },
  });

  if (!member) {
    await interaction.editReply(
      "I have not started tracking you yet. Send a message and try again.",
    );
    return;
  }

  const challenges = await prisma.challenge.findMany({
    where: { guildId: guild.id, enabled: true },
    select: {
      id: true,
      name: true,
      endsAt: true,
      requirements: { select: { id: true, type: true, threshold: true, label: true } },
      progress: {
        where: { memberId: member.id },
        select: { progress: true, completedAt: true },
      },
    },
    orderBy: { createdAt: "asc" },
    take: 10,
  });

  if (challenges.length === 0) {
    await interaction.editReply("There are no challenges running right now.");
    return;
  }

  const lines: string[] = [];

  for (const challenge of challenges) {
    const row = challenge.progress[0];
    const counters = countersFrom(parseStoredProgress(row?.progress), member.level);
    const statuses = requirementStatuses(challenge.requirements, counters);
    const complete = Boolean(row?.completedAt);
    const percent = completionPercent(challenge.requirements, counters);

    const heading = complete
      ? "✓ **Completed**"
      : `**${percent}%** — ${statuses.filter((s) => s.met).length} of ${statuses.length} done`;

    const detail = statuses
      .map((status) => {
        const label = requirementLabel(status.requirement);
        const value = status.met
          ? "✓"
          : `${Math.min(status.current, status.threshold)}/${status.threshold}`;

        return `> ${status.met ? "✓" : "•"} ${label} — ${value}`;
      })
      .join("\n");

    const expiry = challenge.endsAt
      ? `\nEnds <t:${Math.floor(challenge.endsAt.getTime() / 1000)}:R>`
      : "";

    lines.push(`${heading} — ${challenge.name}${expiry}\n${detail}`);
  }

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(KOMU_COLOR)
        .setTitle("Your challenges")
        .setDescription(lines.join("\n\n").slice(0, 4096))
        .setFooter({ text: "Komu" }),
    ],
  });
}