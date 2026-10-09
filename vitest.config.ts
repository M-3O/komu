import { defineConfig } from "vitest/config";

/**
 * Unit tests: no database or Discord connection required.
 *
 * Pure logic (level maths, session signing, stream normalisation, timeout
 * clamping) is testable in isolation. These are what `npm test` runs, and they
 * are safe to run on every commit.
 *
 * Integration tests live in `vitest.integration.config.ts` and are a separate
 * script, because they need DATABASE_URL and write to a real database.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // `*.integration.test.ts` also matches `*.test.ts`, so it has to be
    // excluded explicitly. Without this, `npm test` would demand a database.
    exclude: ["**/*.integration.test.ts", "**/node_modules/**"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      // `server-only` throws unless the bundler marks the module as server
      // code. Vitest has no such notion, so point it at an empty stub: the
      // import is a build-time guard, not runtime behaviour.
      "server-only": new URL("./src/test/server-only-stub.ts", import.meta.url)
        .pathname,
    },
  },
});