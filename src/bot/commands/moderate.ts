import { ModerationActionTypeRecord } from "@prisma/client";
import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
  type GuildMember,
} from "discord.js";

import {
  banMember,
  botCanModerate,
  kickMember,
  timeoutMember,
} from "@/bot/services/moderation";
import { prisma } from "@/lib/db";
import { clearWarnings, countActiveWarnings, listWarnings, recordAction, warnMember } from "@/lib/moderation/warnings";
import { KOMU_COLOR, KOMU_SUCCESS_COLOR } from "../constants";
import { isGuildAdmin } from "../permissions";

/**
 * Manual moderation commands (PRD section 7.11).
 *
 * `/warn`, `/warnings`, `/timeout`, `/kick` and `/ban`.
 *
 * Every one of these is checked twice before anything happens: the caller
 * needs `Administrator`, and the bot needs to be able to act on the target.
 * Discord's own permission rules mean a bot can be asked to ban someone it
 * cannot touch, so the second check is what turns a confusing API error into
 * a sentence a moderator can act on.
 */

const MAX_TIMEOUT_DAYS = 28;

export const warnCommand = new SlashCommandBuilder()
  .setName("warn")
  .setDescription("Warn a member.")
  .addUserOption((option) =>
    option.setName("member").setDescription("Who to warn.").setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("reason")
      .setDescription("Why. The member can see this.")
      .setRequired(true)
      .setMaxLength(500),
  );

export const warningsCommand = new SlashCommandBuilder()
  .setName("warnings")
  .setDescription("Show a member's warnings.")
  .addUserOption((option) =>
    option.setName("member").setDescription("Whose warnings.").setRequired(true),
  )
  .addBooleanOption((option) =>
    option.setName("clear").setDescription("Clear their standing warnings."),
  );

export const timeoutCommand = new SlashCommandBuilder()
  .setName("timeout")
  .setDescription("Temporarily stop a member talking.")
  .addUserOption((option) =>
    option.setName("member").setDescription("Who to time out.").setRequired(true),
  )
  .addIntegerOption((option) =>
    option
      .setName("minutes")
      .setDescription(`How long, in minutes (max ${MAX_TIMEOUT_DAYS * 24 * 60}).`)
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(MAX_TIMEOUT_DAYS * 24 * 60),
  )
  .addStringOption((option) =>
    option.setName("reason").setDescription("Shown in the audit log.").setMaxLength(500),
  );

export const kickCommand = new SlashCommandBuilder()
  .setName("kick")
  .setDescription("Remove a member from the server.")
  .addUserOption((option) =>
    option.setName("member").setDescription("Who to remove.").setRequired(true),
  )
  .addStringOption((option) =>
    option.setName("reason").setDescription("Shown in the audit log.").setMaxLength(500),
  );

export const banCommand = new SlashCommandBuilder()
  .setName("ban")
  .setDescription("Ban a member from the server.")
  .addUserOption((option) =>
    option.setName("member").setDescription("Who to ban.").setRequired(true),
  )
  .addStringOption((option) =>
    option.setName("reason").setDescription("Shown in the audit log.").setMaxLength(500),
  );

/** Reason every action shares. */
const reason = (interaction: ChatInputCommandInteraction) =>
  interaction.options.getString("reason")?.trim() || "No reason given";

/**
 * Everything every command needs before acting.
 *
 * Returns null when the command should stop, having already told the caller
 * why. Doing the checks in one place keeps five commands from each getting
 * the hierarchy check subtly wrong.
 */
async function prepare(
  interaction: ChatInputCommandInteraction,
): Promise<{
  discordMember: GuildMember;
  botMember: GuildMember;
  memberId: string;
  guildId: string;
} | null> {
  if (!interaction.inGuild() || !interaction.guild || !interaction.guildId) {
    await interaction.reply("This command only works inside a server.");
    return null;
  }

  if (!isGuildAdmin(interaction)) {
    await interaction.reply("You need the Administrator permission to moderate.");
    return null;
  }

  const target = interaction.options.getUser("member", true);

  // Null only if the bot is not actually a member, which should not happen but
  // would otherwise surface as a crash inside the hierarchy check.
  const botMember = interaction.guild.members.me;

  if (!botMember) {
    await interaction.reply("I could not read my own role in this server.");
    return null;
  }

  const discordMember = await interaction.guild.members.fetch(target.id).catch(() => null);

  if (!discordMember) {
    await interaction.reply(`${target.username} is not in this server.`);
    return null;
  }

  // The action record is keyed by the member row, which exists only once
  // Komu has seen the member. `/setup` explains the Message Content intent
  // for anyone stuck here.
  const dbMember = await prisma.guildMember.findFirst({
    where: { discordId: discordMember.id },
    select: { id: true, guild: { select: { id: true } } },
  });

  if (!dbMember) {
    await interaction.reply(
      `I have no record of ${target.username}. Have them send a message so I can start tracking them.`,
    );
    return null;
  }

  return {
    discordMember,
    botMember,
    memberId: dbMember.id,
    guildId: dbMember.guild.id,
  };
}

/** Report a failure as an embed, so every command replies the same way. */
async function fail(interaction: ChatInputCommandInteraction, message: string): Promise<void> {
  await interaction.editReply({
    embeds: [new EmbedBuilder().setColor(0xef4444).setDescription(message)],
  });
}

async function done(
  interaction: ChatInputCommandInteraction,
  title: string,
  detail: string,
): Promise<void> {
  await interaction.editReply({
    embeds: [
      new EmbedBuilder().setColor(KOMU_SUCCESS_COLOR).setTitle(title).setDescription(detail),
    ],
  });
}

export async function handleWarn(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const prepared = await prepare(interaction);

  if (!prepared) return;

  const { discordMember, memberId, guildId } = prepared;
  const why = reason(interaction);

  await warnMember({
    guildId,
    memberId,
    moderatorDiscordId: interaction.user.id,
    reason: why,
  });

  const total = await countActiveWarnings(guildId, memberId);

  await done(
    interaction,
    `Warned ${discordMember.user.username}`,
    `Reason: ${why}\n\nThey now have **${total}** standing warning${total === 1 ? "" : "s"}.`,
  );
}

export async function handleWarnings(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const prepared = await prepare(interaction);

  if (!prepared) return;

  const { discordMember, memberId, guildId } = prepared;
  const clear = interaction.options.getBoolean("clear") ?? false;

  if (clear) {
    const cleared = await clearWarnings(guildId, memberId);

    await done(
      interaction,
      cleared > 0 ? `Cleared warnings for ${discordMember.user.username}` : "Nothing to clear",
      cleared > 0
        ? `${cleared} warning${cleared === 1 ? "" : "s"} cleared. The history is kept.`
        : `${discordMember.user.username} had no standing warnings.`,
    );
    return;
  }

  const [warnings, total] = await Promise.all([
    listWarnings(guildId, memberId, 10),
    countActiveWarnings(guildId, memberId),
  ]);

  const lines = warnings.map(
    (warning) =>
      `<t:${Math.floor(warning.createdAt.getTime() / 1000)}:d> — ${
        warning.reason
      }${warning.warningClearedAt ? " *(cleared)*" : ""}`,
  );

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(KOMU_COLOR)
        .setTitle(`Warnings for ${discordMember.user.username}`)
        .setDescription(
          lines.length > 0
            ? `**${total}** standing.\n\n${lines.join("\n")}`.slice(0, 4096)
            : "No warnings.",
        ),
    ],
  });
}

export async function handleTimeout(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const prepared = await prepare(interaction);

  if (!prepared) return;

  const { discordMember, botMember, memberId, guildId } = prepared;
  const minutes = interaction.options.getInteger("minutes", true);
  const why = reason(interaction);

  if (!botCanModerate(botMember, discordMember, "timeout")) {
    await fail(
      interaction,
      `I cannot time out ${discordMember.user.username}. Check that my role is above theirs and that I have the Moderate Members permission.`,
    );
    return;
  }

  const outcome = await timeoutMember(discordMember, minutes * 60_000, why);

  if (!outcome.ok) {
    await fail(interaction, outcome.error ?? "Could not time that member out.");
    return;
  }

  await recordAction({
    guildId,
    type: ModerationActionTypeRecord.MANUAL_TIMEOUT,
    targetMemberId: memberId,
    moderatorDiscordId: interaction.user.id,
    reason: why,
    durationMins: minutes,
  });

  await done(
    interaction,
    `Timed out ${discordMember.user.username}`,
    `${minutes} minute${minutes === 1 ? "" : "s"}. Reason: ${why}`,
  );
}

export async function handleKick(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const prepared = await prepare(interaction);

  if (!prepared) return;

  const { discordMember, botMember, memberId, guildId } = prepared;
  const why = reason(interaction);

  if (!botCanModerate(botMember, discordMember, "kick")) {
    await fail(
      interaction,
      `I cannot remove ${discordMember.user.username}. Check that my role is above theirs and that I have the Kick Members permission.`,
    );
    return;
  }

  const outcome = await kickMember(discordMember, why);

  if (!outcome.ok) {
    await fail(interaction, outcome.error ?? "Could not remove that member.");
    return;
  }

  await recordAction({
    guildId,
    type: ModerationActionTypeRecord.MANUAL_KICK,
    targetMemberId: memberId,
    moderatorDiscordId: interaction.user.id,
    reason: why,
  });

  await done(interaction, `Removed ${discordMember.user.username}`, `Reason: ${why}`);
}

export async function handleBan(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const prepared = await prepare(interaction);

  if (!prepared) return;

  const { discordMember, botMember, memberId, guildId } = prepared;
  const why = reason(interaction);

  if (!botCanModerate(botMember, discordMember, "ban")) {
    await fail(
      interaction,
      `I cannot ban ${discordMember.user.username}. Check that my role is above theirs and that I have the Ban Members permission.`,
    );
    return;
  }

  // Messages are kept. Deleting them is irreversible and usually unnecessary;
  // the moderation log records what happened.
  const outcome = await banMember(discordMember, why, 0);

  if (!outcome.ok) {
    await fail(interaction, outcome.error ?? "Could not ban that member.");
    return;
  }

  await recordAction({
    guildId,
    type: ModerationActionTypeRecord.MANUAL_BAN,
    targetMemberId: memberId,
    moderatorDiscordId: interaction.user.id,
    reason: why,
  });

  await done(interaction, `Banned ${discordMember.user.username}`, `Reason: ${why}`);
}
