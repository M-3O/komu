import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";

import { getLeaderboard } from "@/lib/leaderboards/get-leaderboard";
import {
  METRIC_LABELS,
  PERIOD_LABELS,
  type LeaderboardMetric,
  type LeaderboardPeriod,
} from "@/lib/leaderboards/period";
import { KOMU_COLOR } from "../constants";

/** `/leaderboard` — shows the top community members. */
export const leaderboardCommand = new SlashCommandBuilder()
  .setName("leaderboard")
  .setDescription("Show the top community members.")
  .addStringOption((option) =>
    option
      .setName("period")
      .setDescription("How far back to look.")
      .addChoices(
        { name: PERIOD_LABELS.WEEKLY, value: "WEEKLY" },
        { name: PERIOD_LABELS.MONTHLY, value: "MONTHLY" },
        { name: PERIOD_LABELS.ALL_TIME, value: "ALL_TIME" },
      ),
  )
  .addStringOption((option) =>
    option
      .setName("metric")
      .setDescription("What to rank by.")
      .addChoices(
        { name: "XP", value: "XP" },
        { name: "Messages", value: "ACTIVITY" },
      ),
  );

/** Only these values are accepted from the command. */
const PERIODS: LeaderboardPeriod[] = ["WEEKLY", "MONTHLY", "ALL_TIME"];
const METRICS: LeaderboardMetric[] = ["XP", "ACTIVITY"];

export async function handleLeaderboard(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply();

  if (!interaction.inGuild() || !interaction.guildId) {
    await interaction.editReply("This command only works inside a server.");
    return;
  }

  const rawPeriod = interaction.options.getString("period");
  const rawMetric = interaction.options.getString("metric");

  // Anything unexpected falls back rather than being trusted.
  const period = PERIODS.includes(rawPeriod as LeaderboardPeriod)
    ? (rawPeriod as LeaderboardPeriod)
    : "WEEKLY";

  const metric = METRICS.includes(rawMetric as LeaderboardMetric)
    ? (rawMetric as LeaderboardMetric)
    : "XP";

  const board = await getLeaderboard(interaction.guildId, {
    period,
    metric,
    limit: 10,
  });

  await interaction.editReply({
    embeds: [
      buildLeaderboardEmbed({
        period,
        metric,
        entries: board.entries.map((entry) => ({
          name: entry.nickname ?? entry.username,
          value: entry.value,
          level: entry.level,
        })),
      }),
    ],
  });
}

/** Medals for the top three, since a leaderboard reads better with them. */
function rankLabel(index: number): string {
  return ["🥇", "🥈", "🥉"][index] ?? `${index + 1}.`;
}

/**
 * The leaderboard embed.
 *
 * A pure builder so the layout can be checked without Discord. Discord caps
 * the description at 4096 characters, so a long board is truncated rather
 * than rejected.
 */
export function buildLeaderboardEmbed(input: {
  period: LeaderboardPeriod;
  metric: LeaderboardMetric;
  entries: Array<{ name: string; value: number; level: number }>;
}): EmbedBuilder {
  const unit = input.metric === "XP" ? "XP" : "msgs";

  const description = input.entries.length
    ? input.entries
        .map(
          (entry, index) =>
            `${rankLabel(index)} **${entry.name}** — ${entry.value.toLocaleString()} ${unit} · Lv ${entry.level}`,
        )
        .join("\n")
    : "Nobody has earned anything in this period yet.";

  return new EmbedBuilder()
    .setColor(KOMU_COLOR)
    .setTitle(
      `${METRIC_LABELS[input.metric]} leaderboard · ${PERIOD_LABELS[input.period]}`,
    )
    .setDescription(description.slice(0, 4096))
    .setFooter({ text: "Komu" });
}