import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";

import { prisma } from "@/lib/db";
import { KOMU_ALERT_COLOR, KOMU_COLOR, KOMU_SUCCESS_COLOR } from "../constants";
import { isGuildAdmin } from "../permissions";

/** `/setup` — reports whether Komu is configured for this server. */
export const setupCommand = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Check that Komu is set up for this server.");

/**
 * Core permissions the bot needs for alerts, XP and moderation to work.
 *
 * Listed separately from the moderation helpers because `/setup` reports on
 * them: a missing permission here is the most common cause of "the bot is
 * online but nothing happens".
 */
export const REQUIRED_BOT_PERMISSIONS = [
  "ViewChannel",
  "SendMessages",
  "EmbedLinks",
  "ReadMessageHistory",
  "ManageRoles",
  "ModerateMembers",
  "BanMembers",
  "ManageMessages",
] as const;

export async function handleSetup(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  // Setup reports provider usernames and the bot's permission state, so it is
  // an admin command like the moderation ones. Without this, any member of any
  // server the bot is in could enumerate the installation.
  if (!isGuildAdmin(interaction)) {
    await interaction.reply({
      content: "You need the Administrator permission to check setup.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = await prisma.guild.findFirst({
    orderBy: { createdAt: "asc" },
    select: {
      discordId: true,
      name: true,
      setupCompletedAt: true,
      streamingAccounts: {
        where: { disconnectedAt: null },
        select: { provider: true, username: true, alertConfig: { select: { enabled: true, channelId: true } } },
      },
    },
  });

  // This bot should only ever be in the server Komu manages.
  if (!guild) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(KOMU_ALERT_COLOR)
          .setTitle("Not set up yet")
          .setDescription(
            "No Discord server is connected to this dashboard. Open the Komu dashboard and sign in with Discord to connect your server.",
          ),
      ],
    });
    return;
  }

  if (guild.discordId !== interaction.guildId) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(KOMU_ALERT_COLOR)
          .setTitle("Wrong server")
          .setDescription(
            // Deliberately no server name: the reader is an admin of some
            // other guild, and the configured server is not theirs to know.
            "This installation is configured for a different server.",
          ),
      ],
    });
    return;
  }

  const botMember = interaction.guild?.members.me;
  const missingPermissions =
    botMember?.permissions.missing([...REQUIRED_BOT_PERMISSIONS]) ?? [];

  const lines: string[] = [
    `- Server: **${guild.name}**`,
    `- Streaming accounts: ${
      guild.streamingAccounts.length > 0
        ? guild.streamingAccounts
            .map(
              (account) =>
                `${account.provider} (${account.username}${
                  account.alertConfig?.enabled ? ", alerts on" : ", alerts off"
                })`,
            )
            .join(", ")
        : "none connected yet"
    }`,
  ];

  if (botMember) {
    lines.push(
      missingPermissions.length > 0
        ? `- Missing permissions: ${missingPermissions.join(", ")}`
        : "- Core permissions: all present",
    );
  }

  const fullyConfigured =
    guild.setupCompletedAt !== null &&
    guild.streamingAccounts.length > 0 &&
    missingPermissions.length === 0;

  const embed = new EmbedBuilder()
    .setColor(fullyConfigured ? KOMU_SUCCESS_COLOR : KOMU_COLOR)
    .setTitle(fullyConfigured ? "Komu is ready" : "Setup in progress")
    .setDescription(lines.join("\n"));

  if (missingPermissions.length > 0) {
    embed.addFields({
      name: "Action needed",
      value:
        "Grant the bot these permissions in Server Settings > Roles, then run `/setup` again.",
    });
  }

  await interaction.editReply({ embeds: [embed] });
}