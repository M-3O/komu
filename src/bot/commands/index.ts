import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";

import { handleHelp, helpCommand } from "./help";
import { handlePing, pingCommand } from "./ping";
import { handleSetup, setupCommand } from "./setup";

/**
 * The command registry.
 *
 * A command is a builder (its shape, registered with Discord) plus a handler
 * (what runs when it is used). Both live in the registry so a command cannot
 * be registered without a way to run it.
 *
 * Handlers are dispatched from `commands/index.ts` rather than attached to the
 * builder, which keeps the command modules free of registry state.
 */
export interface BotCommand {
  definition: SlashCommandBuilder;
  handle: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export const COMMANDS: BotCommand[] = [
  { definition: helpCommand, handle: handleHelp },
  { definition: pingCommand, handle: handlePing },
  { definition: setupCommand, handle: handleSetup },
];

/** Look up a handler by command name. */
export function getHandler(
  name: string,
): ((interaction: ChatInputCommandInteraction) => Promise<void>) | undefined {
  return COMMANDS.find((command) => command.definition.name === name)?.handle;
}

/**
 * Check whether the caller may run an admin command.
 *
 * The check is against the caller's live Discord permissions, never anything
 * the client sent (PRD section 9).
 */
export function isGuildAdmin(interaction: ChatInputCommandInteraction): boolean {
  return interaction.memberPermissions?.has("Administrator") ?? false;
}