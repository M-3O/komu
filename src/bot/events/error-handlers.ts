import { Events } from "discord.js";
import type { Client } from "discord.js";

import { createLogger } from "@/lib/logger";

const log = createLogger("bot");

export type FatalReason = "BOT_UNHANDLED_REJECTION" | "BOT_UNCAUGHT_EXCEPTION";

/** Unknown process-level failures are fatal; handled dependency errors are not. */
export function registerProcessHandlers(
  onFatal: (reason: FatalReason) => void,
  source: Pick<NodeJS.Process, "on" | "off"> = process,
): () => void {
  const rejection = () => {
    try { log.error("Fatal bot failure", { code: "BOT_UNHANDLED_REJECTION" }); } catch { /* Best effort. */ }
    onFatal("BOT_UNHANDLED_REJECTION");
  };
  const exception = () => {
    try { log.error("Fatal bot failure", { code: "BOT_UNCAUGHT_EXCEPTION" }); } catch { /* Best effort. */ }
    onFatal("BOT_UNCAUGHT_EXCEPTION");
  };
  source.on("unhandledRejection", rejection);
  source.on("uncaughtException", exception);
  return () => {
    source.off("unhandledRejection", rejection);
    source.off("uncaughtException", exception);
  };
}

/** Log guild deletion, which usually means someone removed the bot. */
export function registerGuildEvents(client: Client): void {
  client.on(Events.GuildDelete, (guild) => {
    log.warn("Removed from a server", { guildId: guild.id, name: guild.name });
  });
}