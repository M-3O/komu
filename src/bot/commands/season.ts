import { EmbedBuilder, MessageFlags, SlashCommandBuilder,
  type ButtonInteraction, type ChatInputCommandInteraction } from "discord.js";
import { CHECK_IN_PREFIX, checkInToSeason, getMemberSeason } from "@/lib/seasons/check-in";
import { seasonsEnabled } from "@/lib/seasons/lifecycle";
import { KOMU_COLOR } from "../constants";
import { tryApplyProgression } from "../services/progression";

export const seasonCommand = new SlashCommandBuilder()
  .setName("season").setDescription("See your Komu Season check-in progress.");

function progressCard(progress: { seasonName: string; count: number; goal: number; rewardStatus?: string }, status?: string) {
  const detail = progress.rewardStatus === "GRANTED" ? "Your season role has been delivered."
    : progress.rewardStatus === "BLOCKED" ? "You earned the role. A server admin needs to resolve delivery."
    : progress.rewardStatus === "PENDING" ? "You earned the role. Komu will deliver it shortly." : null;
  return new EmbedBuilder().setColor(KOMU_COLOR).setTitle(progress.seasonName)
    .setDescription([status, `**${progress.count} of ${progress.goal}** stream check-ins`, detail].filter(Boolean).join("\n\n"));
}

export async function handleSeason(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!interaction.guildId || !seasonsEnabled()) {
    await interaction.editReply("Season progress is unavailable here.");
    return;
  }
  const season = await getMemberSeason(interaction.guildId, interaction.user.id);
  if (!season) {
    await interaction.editReply("There’s no active season in this server.");
    return;
  }
  await interaction.editReply({ embeds: [progressCard({ ...season, seasonName: season.name })] });
}

export async function handleSeasonCheckIn(interaction: ButtonInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!interaction.guildId || !interaction.member || interaction.user.bot) {
    await interaction.editReply("Check in from the Discord server running this season.");
    return;
  }
  const broadcastId = interaction.customId.slice(CHECK_IN_PREFIX.length);
  if (!/^[a-z0-9]{15,40}$/.test(broadcastId)) {
    await interaction.editReply("This check-in button is unavailable.");
    return;
  }
  const result = await checkInToSeason({
    broadcastId, guildDiscordId: interaction.guildId, discordUserId: interaction.user.id,
    username: interaction.user.username, channelId: interaction.channelId, messageId: interaction.message.id,
  });
  if ("error" in result) {
    await interaction.editReply(result.error ?? "Komu couldn’t record this check-in.");
    return;
  }
  // The database commit is final even if Discord cannot display the reply.
  try {
    await interaction.editReply({ embeds: [progressCard(result, result.credited
      ? "You checked in." : "You already checked in for this slot.")] });
  } finally {
    if (result.newAttendance && interaction.guild) {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (member) await tryApplyProgression(member, result.guildId, { activity: { kind: "STREAM_ATTENDANCE" } });
    }
  }
}
