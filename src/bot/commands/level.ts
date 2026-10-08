import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";

import { prisma } from "@/lib/db";
import { levelProgress } from "@/lib/levels/calculate-level";
import { KOMU_COLOR } from "../constants";

/** `/level` — shows a member's level and progress toward the next one. */
export const levelCommand = new SlashCommandBuilder()
  .setName("level")
  .setDescription("Show your level and XP progress.")
  .addUserOption((option) =>
    option
      .setName("member")
      .setDescription("Whose level to show. Defaults to you."),
  );

export async function handleLevel(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply();

  if (!interaction.inGuild() || !interaction.guildId) {
    await interaction.editReply("This command only works inside a server.");
    return;
  }

  const target = interaction.options.getUser("member") ?? interaction.user;

  const member = await prisma.guildMember.findFirst({
    where: { guildId: interaction.guildId, discordId: target.id },
    select: { username: true, nickname: true, xp: true, level: true },
  });

  if (!member) {
    await interaction.editReply(
      target.id === interaction.user.id
        ? "You have not earned any XP yet. Send a message to get started."
        : `${target.username} has not earned any XP yet.`,
    );
    return;
  }

  await interaction.editReply({
    embeds: [
      buildLevelEmbed({
        username: member.nickname ?? member.username,
        xp: member.xp,
        level: member.level,
      }),
    ],
  });
}

/** The `/level` embed. Pure, so the progress bar can be checked in tests. */
export function buildLevelEmbed(input: {
  username: string;
  xp: number;
  level: number;
}): EmbedBuilder {
  const progress = levelProgress(input.xp);
  const filled = Math.round((progress.percent / 100) * 20);

  return new EmbedBuilder()
    .setColor(KOMU_COLOR)
    .setTitle(`${input.username} · Level ${progress.level}`)
    .setDescription(
      [
        `${"█".repeat(filled)}${"░".repeat(20 - filled)}`,
        `**${input.xp.toLocaleString()} XP**`,
        `**${progress.xpToNextLevel.toLocaleString()} XP** to level ${progress.level + 1}`,
      ].join("\n"),
    )
    .setFooter({ text: `${progress.percent}% to next level` });
}