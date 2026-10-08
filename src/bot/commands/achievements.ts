import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from "discord.js";

import { getMemberAchievements } from "@/lib/achievements/unlock";
import { achievementProgress, type AchievementInput } from "@/lib/achievements/evaluate";
import { prisma } from "@/lib/db";
import type { MemberStats } from "@/lib/progression/metrics";
import { KOMU_COLOR } from "../constants";

/**
 * `/achievements` — a member's achievements and what is still locked.
 *
 * Hidden achievements stay secret. Their names, descriptions and icons are not
 * shown until the member unlocks one, so a secret stays a secret. Their count
 * is not shown either, since revealing how many exist would leak that there is
 * something to find.
 */

export const achievementsCommand = new SlashCommandBuilder()
  .setName("achievements")
  .setDescription("Show your achievements and what is still locked.");

export async function handleAchievements(
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
    select: {
      id: true,
      xp: true,
      level: true,
      messageCount: true,
      streamAttendanceCount: true,
      watchTimeMinutes: true,
      joinedAt: true,
    },
  });

  if (!member) {
    await interaction.editReply(
      "I have not started tracking you yet. Send a message and try again.",
    );
    return;
  }

  const [all, unlocked] = await Promise.all([
    prisma.achievement.findMany({
      where: { guildId: guild.id, enabled: true },
      select: {
        id: true,
        name: true,
        description: true,
        icon: true,
        hidden: true,
        type: true,
        threshold: true,
        enabled: true,
      },
      orderBy: { threshold: "asc" },
      take: 25,
    }),
    getMemberAchievements(guild.id, member.id),
  ]);

  const unlockedById = new Map(unlocked.map((entry) => [entry.achievement.id, entry]));

  const stats: MemberStats = {
    xp: member.xp,
    level: member.level,
    messageCount: member.messageCount,
    streamAttendanceCount: member.streamAttendanceCount,
    watchTimeMinutes: member.watchTimeMinutes,
    joinedAt: member.joinedAt,
  };

  // A hidden achievement only appears once it has been unlocked. Before that
  // it is omitted entirely rather than blurred or counted.
  const visible = all.filter(
    (achievement) => !achievement.hidden || unlockedById.has(achievement.id),
  );

  const embed = new EmbedBuilder()
    .setColor(KOMU_COLOR)
    .setTitle("Your achievements")
    .setFooter({ text: "Komu" });

  if (visible.length === 0) {
    embed.setDescription("No achievements have been set up yet.");
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const earned = visible.filter((achievement) => unlockedById.has(achievement.id));
  const lines = visible.map((achievement) => {
    const entry = unlockedById.get(achievement.id);
    const input = achievement as AchievementInput;
    const progress = achievementProgress(input, stats);

    if (entry) {
      return `${achievement.icon} **${achievement.name}**\n${achievement.description}`;
    }

    const current = Math.min(progress, achievement.threshold);

    return `${achievement.icon} **${achievement.name}** — ${current} of ${achievement.threshold}`;
  });

  embed.setDescription(lines.join("\n\n").slice(0, 4096));
  embed.addFields({
    name: "Unlocked",
    value: `${earned.length} of ${visible.length}`,
  });

  await interaction.editReply({ embeds: [embed] });
}