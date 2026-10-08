import type { ChatInputCommandInteraction } from "discord.js";

/**
 * Permission checks for command handlers.
 *
 * Kept out of the command registry so a command can check its own
 * permissions without importing the registry that lists it, which would be a
 * circular import.
 */

/**
 * Whether the caller may run an admin command.
 *
 * Read from the caller's live Discord permissions, never from anything the
 * client sent (PRD section 9). Discord resolves this from the caller's roles
 * at the moment the command is used, so a permission revoked mid-session
 * takes effect immediately.
 */
export function isGuildAdmin(interaction: ChatInputCommandInteraction): boolean {
  return interaction.memberPermissions?.has("Administrator") ?? false;
}