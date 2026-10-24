import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Dashboard actions must resolve the server through the shared guard.
 *
 * This is a source check rather than a behavioural one because the bug it
 * guards against was copied eight times: each action file carried its own
 * `requireGuild` that authenticated the caller, read the first guild in the
 * table and threw the user id away. Every copy looked fine on its own, and
 * eight passing review glances were eight chances to miss the same thing.
 *
 * A ninth copy is the realistic way this comes back, so the invariant is
 * asserted directly. Importing the guard is what makes the authorisation
 * check run; reading the guild row by hand in an action is the shape of the
 * bug, whether or not it is wrong today.
 */

const ACTIONS_DIR = join(process.cwd(), "src", "app", "dashboard");

function actionModules(): Array<[string, string]> {
  return readdirSync(ACTIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(ACTIONS_DIR, entry.name, "actions.ts"))
    .filter((path) => existsSync(path))
    .map((path) => [path.slice(ACTIONS_DIR.length + 1), path]);
}

const HAND_ROLLED_LOOKUP = /prisma\.guild\.(findFirst|findUnique|findFirstOrThrow)/;

describe("dashboard action authorisation", () => {
  const modules = actionModules();

  it("finds the action modules it is meant to check", () => {
    // Without this, a broken glob would make every other assertion vacuous.
    expect(modules.length).toBeGreaterThan(5);
  });

  it.each(modules)("%s resolves the guild through the shared guard", (_name, path) => {
    const source = readFileSync(path, "utf8");

    expect(source).toContain('from "@/lib/dashboard/require-guild"');
    expect(source).not.toMatch(HAND_ROLLED_LOOKUP);
  });
});
