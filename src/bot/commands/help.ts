import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";

import { KOMU_COLOR } from "../constants";

/** `/help` — lists the available commands. */
export const helpCommand = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Show what Komu can do and list the available commands.");

export async function handleHelp(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(KOMU_COLOR)
    .setTitle("Komu commands")
    .setDescription(
      [
        "**`/help`** - Show this message.",
        "**`/setup`** - Check that Komu is set up for this server.",
        "**`/ping`** - Confirm the bot is responsive.",
      ].join("\n"),
    )
    .setFooter({ text: "More commands arrive as features land." });

  await interaction.reply({ embeds: [embed] });
}