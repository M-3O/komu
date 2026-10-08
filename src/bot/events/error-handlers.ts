import { Events } from "discord.js";
import type { Client } from "discord.js";

import { createLogger } from "@/lib/logger";

const log = createLogger("bot");

/**
 * Process-level failure handlers.
 *
 * A bot that dies silently looks identical to a bot that is simply not
 * running, so these make the reason visible.
 */
/**
 * Log process-level failures.
 *
 * A bot that dies silently looks identical to a bot that is not running, so
 * these make the reason visible. Shutdown is handled by the entry point,
 * which owns the client and can close it cleanly.
 */
export function registerProcessHandlers(): void {
  process.on("unhandledRejection", (reason) => {
    log.error("Unhandled promise rejection", {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });

  process.on("uncaughtException", (error) => {
    log.error("Uncaught exception", { reason: error.message });
  });
}

/** Log guild deletion, which usually means someone removed the bot. */
export function registerGuildEvents(client: Client): void {
  client.on(Events.GuildDelete, (guild) => {
    log.warn("Removed from a server", { guildId: guild.id, name: guild.name });
  });
}