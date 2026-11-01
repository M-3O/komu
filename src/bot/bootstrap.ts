import { resolve } from "node:path";

import { config } from "dotenv";

import {
  DatabaseEnvironmentError,
  initializeDatabaseEnvironment,
} from "../lib/config/database-environment";

// Anchor env files to this repository, independent of the caller's cwd.
// Inherited process variables retain dotenv's default precedence.
config({
  path: [resolve(__dirname, "../../.env.local"), resolve(__dirname, "../../.env")],
  quiet: true,
});

function startBot(): void {
  try {
    initializeDatabaseEnvironment();
  } catch (error) {
    console.error(
      "Bot bootstrap failed:",
      error instanceof DatabaseEnvironmentError ? error.message : "UnknownError",
    );
    process.exitCode = 1;
    return;
  }

  void import("./index").catch((error) => {
    console.error(
      "Bot bootstrap failed:",
      error instanceof Error ? error.name : "UnknownError",
    );
    process.exitCode = 1;
  });
}

startBot();
