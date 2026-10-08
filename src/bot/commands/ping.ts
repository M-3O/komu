import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";

import { KOMU_COLOR } from "../constants";

/** `/ping` — a cheap check that the bot is connected and responsive. */
export const pingCommand = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Check that the bot is online and responsive.");

export async function handlePing(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  // Measured after the acknowledgement round trip, so it reflects latency
  // rather than the reply itself.
  await interaction.reply("Pinging...");
  await interaction.editReply(`Pong. Round trip: ${Math.round(interaction.createdTimestamp - Date.now())}ms`);

  await interaction.followUp({
    embeds: [
      new EmbedBuilder()
        .setColor(KOMU_COLOR)
        .setTitle("Komu is online")
        .setDescription(`Gateway heartbeat: ${Math.round(interaction.client.ws.ping)}ms`),
    ],
  });
}