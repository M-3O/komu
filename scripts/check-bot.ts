/**
 * Bot import smoke check.
 *
 * The standalone bot runs under plain `tsx`, not inside a Next.js bundle. A
 * module reachable from the bot that carries `import "server-only"` throws at
 * import time and stops the bot from starting, while `next build` and
 * `tsc` both pass. That failure has happened twice, so it gets an explicit
 * check.
 *
 *   npm run check:bot
 *
 * This only imports the bot's modules. It never connects to Discord.
 */
import { COMMANDS } from "../src/bot/commands";
import "../src/bot/events/error-handlers";
import "../src/bot/events/guild-member-add";
import "../src/bot/events/interaction-create";
import "../src/bot/events/level-up-message";
import "../src/bot/events/message-create";
import "../src/bot/events/message-reaction-add";
import "../src/bot/events/ready";

const commandNames = COMMANDS.map((command) => command.definition.name);

console.log(`Bot modules imported cleanly.`);
console.log(`Commands: ${commandNames.join(", ")}`);

if (commandNames.length === 0) {
  console.error("No commands registered.");
  process.exit(1);
}

const duplicates = commandNames.filter(
  (name, index) => commandNames.indexOf(name) !== index,
);

if (duplicates.length > 0) {
  console.error(`Duplicate command names: ${[...new Set(duplicates)].join(", ")}`);
  process.exit(1);
}

for (const command of COMMANDS) {
  if (typeof command.handle !== "function") {
    console.error(`Command "${command.definition.name}" has no handler.`);
    process.exit(1);
  }
}

console.log("Bot check passed.");
process.exit(0);