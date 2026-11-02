import { PrismaClient } from "@prisma/client";

import {
  databaseDiagnostic,
  DatabaseEnvironmentError,
  initializeDatabaseEnvironment,
  type DatabaseConfiguration,
} from "./config/database-environment";

/**
 * A single shared PrismaClient.
 *
 * Next.js hot-reloads modules in development, which would otherwise open a
 * new pool on every save and eventually exhaust the database's connections.
 * Caching the client on globalThis keeps one instance per process.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaDatabaseConfiguration: DatabaseConfiguration | undefined;
};

// Resolve in the runtime that actually constructs the client. Next's config
// process and its server worker need not share module state.
const database = initializeDatabaseEnvironment();
const cachedDatabase = globalForPrisma.prismaDatabaseConfiguration;

if (
  globalForPrisma.prisma &&
  (!cachedDatabase ||
    cachedDatabase.url !== database.url ||
    cachedDatabase.target !== database.target)
) {
  throw new DatabaseEnvironmentError(
    "Cached Prisma client does not match the selected database. Restart the process.",
  );
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Pin the selection rather than resolving env again on the first query.
    datasourceUrl: database.url,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (!globalForPrisma.prisma) {
  console.info(databaseDiagnostic(database));
}

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaDatabaseConfiguration = database;
}
