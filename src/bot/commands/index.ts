import type {
  SlashCommandOptionsOnlyBuilder,
  ChatInputCommandInteraction,
} from "discord.js";

import { handleHelp, helpCommand } from "./help";
import { handleLevel, levelCommand } from "./level";
import { handlePing, pingCommand } from "./ping";
import { handleProfile, profileCommand } from "./profile";
import { handleSetup, setupCommand } from "./setup";

/**
 * The command registry.
 *
 * A command is a builder (its shape, registered with Discord) plus a handler
 * (what runs when it is used). Both live in the registry so a command cannot
 * be registered without a way to run it.
 *
 * The definition type is `SlashCommandOptionsOnlyBuilder` because that is
 * what `SlashCommandBuilder` narrows to once any option is added. Commands
 * without options still satisfy it.
 */
export interface BotCommand {
  definition: SlashCommandOptionsOnlyBuilder;
  handle: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export const COMMANDS: BotCommand[] = [
  { definition: helpCommand, handle: handleHelp },
  { definition: pingCommand, handle: handlePing },
  { definition: setupCommand, handle: handleSetup },
  { definition: levelCommand, handle: handleLevel },
  { definition: profileCommand, handle: handleProfile },
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