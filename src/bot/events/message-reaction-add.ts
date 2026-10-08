import { Events } from "discord.js";
import type {
  Client,
  MessageReaction,
  PartialMessageReaction,
  User,
  PartialUser,
} from "discord.js";

import { recordStreamAttendance } from "@/lib/attendance/record-attendance";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { tryApplyProgression } from "@/bot/services/progression";

const log = createLogger("stream");

/**
 * Record stream attendance when a member reacts to a live alert.
 *
 * Discord gives no watch telemetry, so this is the signal V1 uses to know
 * someone turned up for a stream (PRD section 7.5).
 *
 * Note for discord.js v14: `MessageReaction` has no `user` property. The
 * reacting user is the event's second argument.
 */
export function registerMessageReactionAdd(client: Client): void {
  client.on(
    Events.MessageReactionAdd,
    (reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) => {
      void onReactionAdd(reaction, user);
    },
  );
}

async function onReactionAdd(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
) {
  try {
    // The message may not be cached, which is why the Message partial is
    // enabled. Fetching fills in the channel so we can tell DMs from servers.
    if (reaction.partial) {
      await reaction.fetch();
    }

    const message = reaction.message;
    const guildId = message.guildId;

    // Attendance is per-server; a DM reaction is not attendance.
    if (!guildId) return;

    const guild = await prisma.guild.findFirst({
      where: { discordId: guildId },
      select: { id: true },
    });

    if (!guild) return;

    const member = message.guild?.members.cache.get(user.id);

    // A partial user has no username until fetched; fall back to the id so
    // the member row still records something meaningful.
    const username = user.username ?? `user-${user.id}`;

    const result = await recordStreamAttendance({
      alertMessageId: message.id,
      discordUserId: user.id,
      guildDiscordId: guildId,
      username,
      nickname: member?.nickname ?? null,
    });

    // Anything other than a first-time record needs no further work: a
    // duplicate reaction, or a reaction on an unrelated message.
    if (!result.recorded) return;

    if (result.xp?.leveledUp) {
      log.info("Level up from attendance", {
        guildId,
        memberId: user.id,
        level: result.xp.newLevel,
      });
    }

    // Attendance can satisfy an attendance role rule or reward, so both are
    // re-checked here as well as after messages.
    if (member) {
      await tryApplyProgression(member, guild.id);
    }
  } catch (error) {
    log.error("Could not record attendance", {
      userId: user.id,
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}