import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every outbound request needs a deadline.
 *
 * A raw `fetch` has none, so a provider that accepts the connection and then
 * goes quiet holds the caller open indefinitely. In the poller that is worse
 * than a slow page: the cycle never finishes, the next tick stacks on top of
 * it, and on YouTube each stacked pass costs 101 quota units.
 *
 * The helper is the only module allowed to call `fetch` directly. This is a
 * source check because the failure is silent: a new client with a raw `fetch`
 * works perfectly until the day a provider hangs.
 */

const LIB = join(process.cwd(), "src", "lib");

/** The one file that is supposed to call `fetch`. */
const HELPER = join(LIB, "http", "fetch-with-timeout.ts");

/** Matches `fetch(` but not `fetchWithTimeout(`. */
const RAW_FETCH = /\bfetch\(/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) return sources(path);

    // Tests stub `fetch`, which is not an outbound request.
    if (path.endsWith(".test.ts")) return [];

    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("outbound requests", () => {
  const files = sources(LIB);

  it("finds the modules it is meant to check", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("gives every request a deadline", () => {
    const offenders = files
      .filter((path) => path !== HELPER)
      .filter((path) => RAW_FETCH.test(readFileSync(path, "utf8")))
      .map((path) => path.slice(LIB.length + 1));

    expect(offenders).toEqual([]);
  });
});
