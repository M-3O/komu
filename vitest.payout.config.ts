import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Intentionally does not load .env files or include other integration suites.
export default defineConfig({
  envDir: false,
  test: {
    include: ["src/lib/challenges/grant-completion.integration.test.ts"],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
    },
  },
});
