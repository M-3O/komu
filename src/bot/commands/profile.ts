import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";

import { prisma } from "@/lib/db";
import { levelProgress } from "@/lib/levels/calculate-level";
import { KOMU_COLOR } from "../constants";

/** `/profile` — a fuller look at a member's activity. */
export const profileCommand = new SlashCommandBuilder()
  .setName("profile")
  .setDescription("Show a community member's profile.")
  .addUserOption((option) =>
    option
      .setName("member")
      .setDescription("Whose profile to show. Defaults to you."),
  );

export async function handleProfile(
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
    select: {
      username: true,
      nickname: true,
      xp: true,
      level: true,
      messageCount: true,
      streamAttendanceCount: true,
      joinedAt: true,
      memberAchievements: {
        select: {
          achievement: { select: { name: true, icon: true } },
        },
        orderBy: { unlockedAt: "desc" },
        take: 12,
      },
      rewardGrants: {
        select: { reward: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 12,
      },
    },
  });

  if (!member) {
    await interaction.editReply(
      target.id === interaction.user.id
        ? "You have not been active yet. Send a message to get started."
        : `${target.username} has not been active yet.`,
    );
    return;
  }

  const displayName = member.nickname ?? member.username;
  const daysInServer = Math.max(
    1,
    Math.floor((Date.now() - member.joinedAt.getTime()) / 86_400_000),
  );

  const embed = new EmbedBuilder()
    .setColor(KOMU_COLOR)
    .setTitle(displayName)
    .setDescription(
      buildProfileSummary({
        xp: member.xp,
        messageCount: member.messageCount,
        streamAttendanceCount: member.streamAttendanceCount,
        daysInServer,
      }),
    )
    .setFooter({ text: `Level ${member.level}` });

  if (target.displayAvatarURL()) {
    embed.setThumbnail(target.displayAvatarURL());
  }

  const achievements = member.memberAchievements.map(
    (entry) => `${entry.achievement.icon} ${entry.achievement.name}`,
  );

  if (achievements.length > 0) {
    embed.addFields({ name: "Achievements", value: achievements.join(" · ") });
  }

  const rewards = member.rewardGrants.map((entry) => entry.reward.name);

  if (rewards.length > 0) {
    embed.addFields({ name: "Rewards", value: rewards.join(" · ") });
  }

  await interaction.editReply({ embeds: [embed] });
}

/** The profile body. Pure, so the wording can be checked in tests. */
export function buildProfileSummary(input: {
  xp: number;
  messageCount: number;
  streamAttendanceCount: number;
  daysInServer: number;
}): string {
  const progress = levelProgress(input.xp);

  return [
    `**Level ${progress.level}** · ${input.xp.toLocaleString()} XP`,
    `${progress.xpToNextLevel.toLocaleString()} XP to level ${progress.level + 1}`,
    "",
    `Messages: **${input.messageCount.toLocaleString()}**`,
    `Streams attended: **${input.streamAttendanceCount.toLocaleString()}**`,
    `In the server: **${input.daysInServer} day${input.daysInServer === 1 ? "" : "s"}**`,
  ].join("\n");
}