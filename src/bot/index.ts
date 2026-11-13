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
import { Client } from "discord.js";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { publishWorkerHeartbeat, workerMonitoringEnabled } from "@/lib/monitoring/worker-heartbeat";
import { getBotToken, INTENTS, PARTIALS } from "./config";
import { registerGuildEvents } from "./events/error-handlers";
import { registerGuildMemberAdd } from "./events/guild-member-add";
import { registerInteractionCreate } from "./events/interaction-create";
import { registerMessageCreate } from "./events/message-create";
import { registerMessageReactionAdd } from "./events/message-reaction-add";
import { registerReady } from "./events/ready";
import { startBotRuntime } from "./runtime";

async function main() {
  const client = new Client({ intents: [...INTENTS], partials: [...PARTIALS] });
  await startBotRuntime({
    client,
    login: () => client.login(getBotToken()),
    disconnectDatabase: () => prisma.$disconnect(),
    monitoringSecret: process.env.BOT_MONITORING_SECRET,
    publishHeartbeat: workerMonitoringEnabled() ? publishWorkerHeartbeat : undefined,
    configure: () => {
      registerReady(client);
      registerGuildEvents(client);
      registerInteractionCreate(client);
      registerMessageCreate(client);
      registerGuildMemberAdd(client);
      registerMessageReactionAdd(client);
    },
  });
}

void main().catch(() => {
  createLogger("bot").error("Bot crashed on startup", { code: "BOT_STARTUP_FAILED" });
  process.exitCode = 1;
});
