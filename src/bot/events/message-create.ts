import { ChannelType, Events } from "discord.js";
import type { Client, Message } from "discord.js";

import { handleMessageActivity } from "@/lib/xp/message-xp";
import { prisma } from "@/lib/db";
import { moderateMessage } from "@/lib/moderation/moderate-message";
import { tryApplyProgression } from "@/bot/services/progression";
import { buildLevelUpEmbed } from "./level-up-message";
import { createLogger } from "@/lib/logger";

const log = createLogger("xp");

/**
 * Award XP for Discord messages.
 *
 * The bot must have the Message Content privileged intent enabled for this to
 * fire; without it `message.content` is empty and nothing is recorded.
 */
export function registerMessageCreate(client: Client): void {
  client.on(Events.MessageCreate, (message: Message) => {
    void onMessage(message, client);
  });
}

async function onMessage(message: Message, client: Client) {
  const guild = message.guild;

  // Ignore DMs: members have no XP outside a configured server.
  if (!message.guildId || !guild || message.channel.type === ChannelType.DM) return;

  // Ignore bots and webhooks, including this bot.
  if (message.author.bot || message.author.system) return;

  // An empty content means the Message Content intent is off, or the message
  // is an embed-only interaction. Either way there is nothing to score.
  if (!message.content || message.content.trim().length === 0) return;

  try {
    // Resolved once and shared. `guild.id` above is Discord's snowflake, which
    // is not the id the rest of the application stores rules under.
    const dbGuild = await prisma.guild.findFirst({
      where: { discordId: guild.id },
      select: { id: true },
    });

    if (!dbGuild) return;

    // Moderation runs before XP on purpose. A message the word filter deleted
    // must not also earn XP, or a spammer is rewarded for the exact behaviour
    // the filter exists to stop.
    const moderation = await moderateMessage(message, dbGuild.id);

    if (moderation.deleted) {
      log.debug("Message was deleted, no XP awarded", {
        guildId: message.guildId,
        userId: message.author.id,
      });
      return;
    }

    const result = await handleMessageActivity({
      guildId: message.guildId,
      guildDiscordId: guild.id,
      discordUserId: message.author.id,
      username: message.author.username,
      nickname: guild.members.cache.get(message.author.id)?.nickname ?? null,
      message: message.content,
    });

    if (!result.recorded) return;

    // Roles, rewards, challenges and achievements are checked on every
    // qualifying message, not only on a level change: a membership-age rule or
    // a message-count reward can become satisfied without a level up.
    if (message.member) {
      await tryApplyProgression(message.member, dbGuild.id, {
        activity: { kind: "MESSAGE" },
      });
    }

    if (!result.xp?.leveledUp) {
      if (result.denial) {
        log.debug("Message did not earn XP", {
          guildId: message.guildId,
          userId: message.author.id,
          reason: result.denial,
        });
      }
      return;
    }

    // Only announce on a real level change.
    await announceLevelUp(message, client, result.xp.newLevel, result.xp.totalXp);
  } catch (error) {
    log.error("Message XP handling failed", {
      guildId: message.guildId,
      userId: message.author.id,
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}

/** Post the level-up message in the channel where it happened. */
async function announceLevelUp(
  message: Message,
  client: Client,
  level: number,
  totalXp: number,
) {
  const channel = message.channel;

  // Only channels that can actually be posted to.
  if (!channel.isTextBased() || !("send" in channel)) return;

  try {
    await channel.send({
      embeds: [
        buildLevelUpEmbed({
          username: message.author.username,
          level,
          totalXp,
          botName: client.user?.tag ?? "Komu",
        }),
      ],
    });
  } catch (error) {
    // Missing Send Messages or Embed Links: log rather than retry.
    log.warn("Could not post level up message", {
      channelId: message.channel.id,
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}