import { resolve } from "node:path";

import { config } from "dotenv";

import {
  DatabaseEnvironmentError,
  initializeDatabaseEnvironment,
} from "../lib/config/database-environment";

config({
  path: [resolve(__dirname, "../../.env.local"), resolve(__dirname, "../../.env")],
  quiet: true,
});

function startRegistration(): void {
  try {
    initializeDatabaseEnvironment();
  } catch (error) {
    console.error(
      "Bot registration bootstrap failed:",
      error instanceof DatabaseEnvironmentError ? error.message : "UnknownError",
    );
    process.exitCode = 1;
    return;
  }

  void import("./register-commands").catch((error) => {
    console.error(
      "Bot registration bootstrap failed:",
      error instanceof Error ? error.name : "UnknownError",
    );
    process.exitCode = 1;
  });
}

startRegistration();
