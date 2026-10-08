import { Events } from "discord.js";
import type { Client, GuildMember } from "discord.js";

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { tryApplyProgression } from "@/bot/services/progression";

const log = createLogger("bot");

/**
 * Check roles and rewards when someone joins.
 *
 * Covers anything whose threshold is already met at join time, such as a
 * "joined before" role or a zero-day reward. Anything that needs time to
 * accrue is picked up by the message handler.
 */
export function registerGuildMemberAdd(client: Client): void {
  client.on(Events.GuildMemberAdd, (member: GuildMember) => {
    void onMemberJoin(member);
  });
}

async function onMemberJoin(member: GuildMember) {
  try {
    const guild = await prisma.guild.findFirst({
      where: { discordId: member.guild.id },
      select: { id: true, name: true },
    });

    // Komu only manages its configured server.
    if (!guild) return;

    // Track the member so rules have something to measure. Roles are not
    // granted here: new members have no XP and no messages yet.
    await prisma.guildMember.upsert({
      where: {
        guildId_discordId: { guildId: guild.id, discordId: member.id },
      },
      update: {
        username: member.user.username,
        nickname: member.nickname,
        // Preserve the real join date rather than "now", which is what the
        // membership-age rules measure.
        joinedAt: member.joinedAt ?? new Date(),
      },
      create: {
        guildId: guild.id,
        discordId: member.id,
        username: member.user.username,
        nickname: member.nickname,
        joinedAt: member.joinedAt ?? new Date(),
      },
    });

    // A join advances no counter, but it is the moment a level requirement that
    // is already met can first be noticed.
    await tryApplyProgression(member, guild.id, { activity: { kind: "JOINED" } });
  } catch (error) {
    log.error("Could not handle a new member", {
      guildId: member.guild.id,
      memberId: member.id,
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}