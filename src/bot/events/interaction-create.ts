import {
  Events,
  Interaction,
  MessageFlags,
} from "discord.js";
import type { Client } from "discord.js";

import { createLogger } from "@/lib/logger";
import { getAutocompleteHandler, getHandler } from "../commands";

const log = createLogger("bot");

/**
 * Route slash command interactions to their handler.
 *
 * Discord requires a reply within about three seconds, so anything slow
 * acknowledges immediately. Handler failures are reported to the user rather
 * than left to surface as a timeout.
 */
export function registerInteractionCreate(client: Client): void {
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    // Autocomplete arrives as its own interaction type and must be answered
    // before the command is ever run, so it is routed first.
    if (interaction.isAutocomplete()) {
      const autocomplete = getAutocompleteHandler(interaction.commandName);

      if (autocomplete) {
        try {
          await autocomplete(interaction);
        } catch (error) {
          log.error("Autocomplete failed", {
            commandName: interaction.commandName,
            guildId: interaction.guildId,
            reason: error instanceof Error ? error.message : "unknown",
          });
        }
      }

      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;
    const handler = getHandler(commandName);

    if (!handler) {
      log.warn("No handler for command", {
        commandName,
        guildId: interaction.guildId,
      });

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "That command is not available.",
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    try {
      await handler(interaction);
    } catch (error) {
      log.error("Command failed", {
        commandName,
        guildId: interaction.guildId,
        userId: interaction.user.id,
        reason: error instanceof Error ? error.message : "unknown",
      });

      const message = "Something went wrong running that command.";

      if (interaction.deferred) {
        await interaction.editReply({ content: message });
      } else if (!interaction.replied) {
        await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
      }
    }
  });
}