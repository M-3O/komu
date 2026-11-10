import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Explicitly opt-in disposable-local PostgreSQL suite. It never loads dotenv
 * files and its setup file rejects inherited application, production, and
 * Neon TEST URLs before Prisma is imported.
 */
export default defineConfig({
  envDir: false,
  test: {
    include: ["src/lib/tiktok/database.postgres.integration.test.ts"],
    setupFiles: ["src/test/tiktok-postgres-setup.ts"],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./src/test/server-only-stub.ts", import.meta.url),
      ),
    },
  },
});
