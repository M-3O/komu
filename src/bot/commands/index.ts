import type {
  SlashCommandOptionsOnlyBuilder,
  AutocompleteInteraction,
  ChatInputCommandInteraction,
} from "discord.js";

import { handleChallenge, challengeCommand } from "./challenge";
import { handleHelp, helpCommand } from "./help";
import { handleLeaderboard, leaderboardCommand } from "./leaderboard";
import { handleLevel, levelCommand } from "./level";
import { handlePing, pingCommand } from "./ping";
import { handleProfile, profileCommand } from "./profile";
import { handleReward, handleRewardAutocomplete, rewardCommand } from "./reward";
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
  /** Only for commands whose options use `setAutocomplete(true)`. */
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
}

export const COMMANDS: BotCommand[] = [
  { definition: helpCommand, handle: handleHelp },
  { definition: pingCommand, handle: handlePing },
  { definition: setupCommand, handle: handleSetup },
  { definition: levelCommand, handle: handleLevel },
  { definition: profileCommand, handle: handleProfile },
  { definition: leaderboardCommand, handle: handleLeaderboard },
  { definition: challengeCommand, handle: handleChallenge },
  {
    definition: rewardCommand,
    handle: handleReward,
    autocomplete: handleRewardAutocomplete,
  },
];

/** Look up a handler by command name. */
export function getHandler(
  name: string,
): ((interaction: ChatInputCommandInteraction) => Promise<void>) | undefined {
  return COMMANDS.find((command) => command.definition.name === name)?.handle;
}

/** Look up an autocomplete handler by command name. */
export function getAutocompleteHandler(
  name: string,
): ((interaction: AutocompleteInteraction) => Promise<void>) | undefined {
  return COMMANDS.find((command) => command.definition.name === name)?.autocomplete;
}