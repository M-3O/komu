import { defineConfig } from "vitest/config";

/**
 * Unit tests, no database or Discord connection required.
 *
 * Pure logic (level maths, session signing, stream normalisation, timeout
 * clamping) is testable in isolation. Integration tests against a real
 * database arrive alongside the features that need them.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      // `server-only` throws unless the bundler marks the module as server
      // code. Vitest has no such notion, so point it at an empty stub: the
      // import is a build-time guard, not runtime behaviour.
      "server-only": new URL(
        "./src/test/server-only-stub.ts",
        import.meta.url,
      ).pathname,
    },
  },
});