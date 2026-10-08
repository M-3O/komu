import { ActivityType, Events } from "discord.js";
import type { Client } from "discord.js";

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";

const log = createLogger("bot");

/**
 * Report readiness once connected, then keep the presence updated.
 *
 * Also logs which server the bot joined and whether that server is the one
 * configured in the dashboard, which is the first thing to check when setup
 * looks wrong.
 */
export function registerReady(client: Client): void {
  client.on(Events.ClientReady, async (readyClient) => {
    log.info("Bot is online", {
      user: readyClient.user.tag,
      guilds: readyClient.guilds.cache.size,
    });

    readyClient.user.setActivity("with your community", {
      type: ActivityType.Watching,
    });

    for (const guild of readyClient.guilds.cache.values()) {
      log.info("In server", {
        guildId: guild.id,
        name: guild.name,
        members: guild.memberCount,
      });
    }

    await reportGuildMatch(readyClient);
  });

  client.on(Events.GuildCreate, (guild) => {
    log.info("Joined a server", { guildId: guild.id, name: guild.name });
  });

  // Useful when diagnosing a connection problem; the bot drops and reconnects
  // on its own, so this is informational.
  client.on(Events.Error, (error) => {
    log.error("Client error", { reason: error.message });
  });

  // The bot reconnects automatically, so a status change is worth logging but
  // is not itself a failure.
  client.on(Events.Debug, (message) => {
    if (message.includes("resume") || message.includes("disconnect")) {
      log.warn("Gateway status change", {
        status: client.ws.status,
        detail: message.slice(0, 200),
      });
    }
  });
}

/** Compare the servers the bot is in against the dashboard configuration. */
async function reportGuildMatch(client: Client) {
  try {
    const configured = await prisma.guild.findFirst({
      orderBy: { createdAt: "asc" },
      select: { discordId: true, name: true },
    });

    if (!configured) {
      log.warn("No server configured in the dashboard yet");
      return;
    }

    const joined = client.guilds.cache.has(configured.discordId);

    log.info(
      joined
        ? "Bot is in the configured server"
        : "Bot is NOT in the configured server",
      { configuredGuildId: configured.discordId, configuredName: configured.name },
    );
  } catch (error) {
    log.error("Could not compare bot servers with the dashboard", {
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}