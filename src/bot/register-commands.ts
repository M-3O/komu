import { config } from "dotenv";

/**
 * Register slash commands with Discord.
 *
 * Kept separate from the bot process so a restart never rewrites commands,
 * which Discord rate-limits aggressively.
 *
 *   npm run bot:register              # global (production)
 *   npm run bot:register -- --guild   # one server, for development
 *
 * Global commands can take up to an hour to appear. Guild commands appear
 * immediately, so use `--guild` while developing. Command bodies cannot mix
 * global and guild commands; re-run without `--guild` before shipping.
 */
config({ path: [".env.local", ".env"] });

import { REST, Routes } from "discord.js";

import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { COMMANDS } from "./commands";
import { getApplicationId, getBotToken } from "./config";

const log = createLogger("bot");

async function main() {
  const useGuild = process.argv.includes("--guild");

  const applicationId = getApplicationId();
  const token = getBotToken();

  const body = COMMANDS.map((command) => command.definition.toJSON());
  const rest = new REST({ version: "10" }).setToken(token);

  let route: `/${string}`;
  let scope: string;

  if (useGuild) {
    const guild = await prisma.guild.findFirst({
      orderBy: { createdAt: "asc" },
      select: { discordId: true, name: true },
    });

    if (!guild) {
      throw new Error(
        "No server configured. Sign in through the dashboard first, or run without --guild to register globally.",
      );
    }

    route = Routes.applicationGuildCommands(applicationId, guild.discordId);
    scope = `server ${guild.name} (${guild.discordId})`;
  } else {
    route = Routes.applicationCommands(applicationId);
    scope = "all servers (global)";
  }

  log.info("Registering commands", {
    scope,
    count: body.length,
    names: body.map((command) => command.name),
  });

  // `put` returns the command list Discord now holds.
  const result: unknown = await rest.put(route, { body });
  const registered = Array.isArray(result) ? result.length : 0;

  log.info("Commands registered", {
    scope,
    registered,
  });

  await prisma.$disconnect();
}

main().catch(async (error) => {
  log.error("Command registration failed", {
    reason: error instanceof Error ? error.message : "unknown",
  });
  await prisma.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});