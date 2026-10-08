import { EmbedBuilder } from "discord.js";

import { KOMU_COLOR } from "@/bot/constants";

/**
 * The message posted when a member levels up.
 *
 * A plain function so the wording can be checked without posting anything.
 */
export function buildLevelUpEmbed(input: {
  username: string;
  level: number;
  totalXp: number;
  botName: string;
}): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(KOMU_COLOR)
    .setTitle(`${input.username} reached level ${input.level}`)
    .setDescription("Nice one. Keep it going.")
    .addFields({ name: "Total XP", value: input.totalXp.toLocaleString(), inline: true })
    .setFooter({ text: input.botName });
}