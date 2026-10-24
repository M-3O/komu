import { config } from "dotenv";
import { defineConfig } from "vitest/config";

/**
 * Integration tests: require a real database.
 *
 * These cover what unit tests cannot reach. A unique constraint either holds
 * or it does not, two grants either race or they do not, and a transaction
 * either rolls back or it does not. None of that is answerable in isolation,
 * and most of the bugs found while building Komu were in exactly this layer:
 * a Discord snowflake passed where a database id was expected, which matched
 * nothing and reported no error.
 *
 * Run with `npm run test:integration`. Each test builds its own guild and
 * member rows and removes them afterwards, so the suite is safe to run against
 * a development database.
 *
 * Never pointed at production. The files below all write, and a mistake here
 * would delete real data rather than test data.
 */

/**
 * Next.js loads `.env.local` for the app but vitest does not, so without this
 * every integration test failed on a missing DATABASE_URL. Loaded the same way
 * the bot loads it, and a variable already in the environment wins, so CI can
 * still point the suite somewhere else.
 */
config({ path: [".env.local", ".env"] });

export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    environment: "node",
    // A shared database means these cannot run in parallel without one test's
    // cleanup deleting another's rows.
    fileParallelism: false,
    // These run against a remote Neon pooler, not a local database. A single
    // test does several dozen round trips, and the pooler occasionally takes
    // seconds just to hand out a connection after idling. At 30s that showed
    // up as a test failing once and then passing on every rerun, which reads
    // as a real bug and costs an investigation to disprove. The generous
    // timeout only costs anything when something is already wrong.
    testTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      "server-only": new URL("./src/test/server-only-stub.ts", import.meta.url)
        .pathname,
    },
  },
});