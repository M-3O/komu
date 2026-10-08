import {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";

import { prisma } from "@/lib/db";
import { METRIC_LABELS, METRIC_UNITS } from "@/lib/progression/metrics";
import { grantEligibleRewards } from "@/lib/rewards/grant";
import { KOMU_ALERT_COLOR, KOMU_COLOR, KOMU_SUCCESS_COLOR } from "../constants";
import { isGuildAdmin } from "../permissions";

/**
 * `/reward` — hand a reward to a member by hand.
 *
 * The PRD's "record a manual reward" case: a creator compensating someone, or
 * handing out a prize for an event Komu did not measure.
 *
 * This does not bypass the condition. A moderator can re-grant a reward a
 * member already has, but cannot grant one they have not earned, or the
 * command would be an XP printer with extra steps.
 *
 * Note for discord.js v14: autocomplete options use `setAutocomplete(true)`,
 * not v15's `addAutocomplete`, and arrive as an `AutocompleteInteraction`.
 */

export const rewardCommand = new SlashCommandBuilder()
  .setName("reward")
  .setDescription("Grant a reward to a member by hand.")
  .addUserOption((option) =>
    option.setName("member").setDescription("Who receives the reward.").setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("reward")
      .setDescription("Which reward to grant.")
      .setRequired(true)
      .setAutocomplete(true),
  );

/** Discord allows at most 25 autocomplete choices per response. */
const MAX_CHOICES = 25;

/** Offer reward names as the moderator types. */
export async function handleRewardAutocomplete(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused();

  // Nothing to suggest outside a configured server.
  if (!interaction.inCachedGuild()) {
    await interaction.respond([]);
    return;
  }

  const guild = await prisma.guild.findFirst({
    where: { discordId: interaction.guildId },
    select: { id: true },
  });

  if (!guild) {
    await interaction.respond([]);
    return;
  }

  const rewards = await prisma.reward.findMany({
    where: { guildId: guild.id, enabled: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: MAX_CHOICES,
  });

  const needle = focused.toLowerCase();

  await interaction.respond(
    rewards
      .filter((reward) => reward.name.toLowerCase().includes(needle))
      // The filter runs after `take`, so a narrow search can come back empty
      // even when matches exist further down the list. Trimming again is
      // cheaper than querying without a limit and slicing in memory.
      .slice(0, MAX_CHOICES)
      .map((reward) => ({ name: reward.name, value: reward.id })),
  );
}

export async function handleReward(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply("This command only works inside a server.");
    return;
  }

  // Permission is read from Discord, never from anything the client sent.
  if (!isGuildAdmin(interaction)) {
    await interaction.reply("You need the Administrator permission to grant rewards.");
    return;
  }

  const target = interaction.options.getUser("member", true);
  const rewardId = interaction.options.getString("reward", true);

  await interaction.deferReply();

  const guild = await prisma.guild.findFirst({
    where: { discordId: interaction.guildId! },
    select: { id: true },
  });

  if (!guild) {
    await interaction.editReply("No server is connected to this dashboard yet.");
    return;
  }

  const discordMember = await interaction.guild!.members.fetch(target.id).catch(() => null);

  if (!discordMember) {
    await interaction.editReply(`${target.username} is not in this server.`);
    return;
  }

  // Rewards are measured and recorded against the member row. A member Komu
  // has never tracked has no XP, so nothing would ever fire for them.
  const memberRow = await prisma.guildMember.findFirst({
    where: { guildId: guild.id, discordId: target.id },
    select: { id: true },
  });

  if (!memberRow) {
    await interaction.editReply(
      `Komu has no record of ${target.username} yet. Have them send a message so I can start tracking them.`,
    );
    return;
  }

  const reward = await prisma.reward.findFirst({
    where: { id: rewardId, guildId: guild.id },
    select: {
      id: true,
      name: true,
      enabled: true,
      conditionMetric: true,
      conditionThreshold: true,
    },
  });

  if (!reward) {
    await interaction.editReply("That reward was not found.");
    return;
  }

  const result = await grantEligibleRewards({
    member: discordMember,
    guildId: guild.id,
    manualByDiscordId: interaction.user.id,
    onlyRewardId: reward.id,
  });

  const condition = `${reward.conditionThreshold} ${METRIC_UNITS[reward.conditionMetric]}`;
  const requires = {
    name: "Requires",
    value: `${METRIC_LABELS[reward.conditionMetric]} of ${condition}`,
  };

  if (result.granted.includes(reward.name)) {
    // The grant is recorded even when an action failed, so the creator is
    // told what needs fixing rather than seeing a silent no-op.
    const failed = result.failed.find((entry) => entry.reward === reward.name);

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(failed ? KOMU_ALERT_COLOR : KOMU_SUCCESS_COLOR)
          .setTitle(`Granted: ${reward.name}`)
          .setDescription(
            failed
              ? `Partly granted to ${target.username}.\n\nNeeds fixing: ${failed.reason}`
              : `Granted to ${target.username}.`,
          )
          .addFields(requires),
      ],
    });
    return;
  }

  // Nothing was granted. Only two reasons remain, and they need different
  // wording: the creator can enable a reward, but cannot unblock a condition.
  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(KOMU_COLOR)
        .setTitle(`Cannot grant: ${reward.name}`)
        .setDescription(
          reward.enabled
            ? `${target.username} has not reached ${condition} yet, so this reward cannot be granted by hand.`
            : "That reward is disabled. Enable it on the dashboard first.",
        )
        .addFields(requires),
    ],
  });
}