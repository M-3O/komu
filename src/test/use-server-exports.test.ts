import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A "use server" file may only export async functions.
 *
 * Breaking the rule fails in the browser, not on the server: the server render
 * succeeds and returns 200, and the error only appears when the Client
 * Component imports the module and the framework validates its exports. Seven
 * dashboard pages exported a plain object for their initial form state and all
 * seven failed this way, which is why the rule is worth a test rather than a
 * note in a commit message.
 *
 * Type exports are fine. They are erased before the module reaches the
 * browser, so only values are checked.
 */

const SRC = join(process.cwd(), "src");

/** A value export that is not an async function. */
const BAD_EXPORT = /^export\s+(?!async\b|function\s*\*|type\s|interface\s|declare\b)/m;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) return sourceFiles(path);

    return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  });
}

/** Whether the file opens with the directive, ignoring a leading comment. */
function hasUseServerDirective(source: string): boolean {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  return /^\s*["']use server["'];?\s*$/m.test(withoutComments.split("\n")[0] ?? "");
}

describe("use server modules", () => {
  const actionModules = sourceFiles(SRC).filter((path) =>
    hasUseServerDirective(readFileSync(path, "utf8")),
  );

  it("finds the action modules it is meant to check", () => {
    // A silent zero here would make every other assertion pass for free.
    expect(actionModules.length).toBeGreaterThan(5);
  });

  it.each(actionModules.map((path) => [path.slice(SRC.length + 1), path]))(
    "%s exports only async functions",
    (_name, path) => {
      const offenders = readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => BAD_EXPORT.test(line));

      expect(offenders).toEqual([]);
    },
  );
});