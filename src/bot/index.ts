import { config } from "dotenv";

/**
 * Bot entry point.
 *
 * Runs as its own long-lived Node process next to the Next.js app:
 *
 *   npm run bot
 *
 * This is not a "worker" in the sense the plan rules out: there is no queue
 * and no background job system. A Discord gateway connection has to be held
 * open for as long as the bot is online, which is why it lives in its own
 * process instead of inside a request handler.
 */
config({ path: [".env.local", ".env"] });

import { Client } from "discord.js";

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { getBotToken, INTENTS, PARTIALS } from "./config";
import { registerProcessHandlers, registerGuildEvents } from "./events/error-handlers";
import { registerInteractionCreate } from "./events/interaction-create";
import { registerMessageCreate } from "./events/message-create";
import { registerReady } from "./events/ready";

const log = createLogger("bot");

async function main() {
  registerProcessHandlers();

  const client = new Client({
    intents: [...INTENTS],
    partials: [...PARTIALS],
  });

  registerReady(client);
  registerGuildEvents(client);
  registerInteractionCreate(client);
  registerMessageCreate(client);

  // Command registration is handled by `npm run bot:register`, so a restart
  // never rewrites commands on Discord.

  // Close the gateway connection and the database on shutdown, so a restart
  // or deploy does not leave the bot appearing online briefly.
  const shutdown = async (signal: string) => {
    log.info(`Received ${signal}; shutting down`);

    try {
      await client.destroy();
      await prisma.$disconnect();
    } catch (error) {
      log.error("Error during shutdown", {
        reason: error instanceof Error ? error.message : "unknown",
      });
    }

    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await client.login(getBotToken());
  } catch (error) {
    log.error("Could not connect to Discord", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    process.exitCode = 1;
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  log.error("Bot crashed on startup", {
    reason: error instanceof Error ? error.message : "unknown",
  });
  process.exitCode = 1;
});