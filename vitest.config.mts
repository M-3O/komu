import { defineConfig } from "vitest/config";

/**
 * Unit tests only, for now.
 *
 * Pure logic (level maths, reward conditions, stream normalisation) needs no
 * database or Discord connection. Integration tests against a real database
 * arrive alongside the features that need them.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
});