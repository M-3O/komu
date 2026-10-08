/**
 * Word filter matching.
 *
 * Pure, so the rules that delete real messages can be tested without Discord
 * or a database.
 */

/** Escape a phrase for use inside a regular expression. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A word boundary, as ASCII letters, digits and underscore.
 *
 * Deliberately ASCII rather than Unicode letters. Unicode boundaries would be
 * slightly more precise for Latin text, but they mean a blocked word followed
 * by any CJK character does not match, so the whole filter can be evaded by
 * typing one extra character and the creator has no way to see why. Silent
 * evasion is worse than the rare false positive.
 *
 * ASCII still protects the case that actually matters: "ass" does not match
 * inside "class", "assignment" or "pass".
 */
const BOUNDARY = "[A-Za-z0-9_]";

/**
 * Match a message against a list of blocked words or phrases.
 *
 * Matching is case-insensitive and whole-word. Whole-word matters: without it
 * blocking "ass" would also delete "class", "assignment" and "pass", which is
 * how a filter becomes the reason members leave.
 *
 * Returns the configured entry that matched, so the warning can name it, or
 * null when the message is clean.
 */
export function findBlockedWord(
  content: string,
  blockedWords: string[],
): string | null {
  const haystack = content.toLowerCase();

  for (const raw of blockedWords) {
    const needle = raw.trim().toLowerCase();

    // An empty entry would otherwise match at position zero and delete every
    // message.
    if (needle.length === 0) continue;

    const pattern = new RegExp(
      `(?<!${BOUNDARY})${escapeRegExp(needle)}(?!${BOUNDARY})`,
    );

    if (pattern.test(haystack)) return raw;
  }

  return null;
}

/** Whether a message trips the filter. */
export function isBlocked(content: string, blockedWords: string[]): boolean {
  return findBlockedWord(content, blockedWords) !== null;
}

/**
 * Parse a creator's comma or newline separated word list.
 *
 * Empty entries are dropped, because a trailing comma is the common way one
 * sneaks in, and an empty entry matches everything.
 */
export function parseWordList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    // Case-insensitive dedupe, keeping the creator's own capitalisation.
    .filter((entry, index, all) => {
      const needle = entry.toLowerCase();
      return all.findIndex((other) => other.toLowerCase() === needle) === index;
    });
}