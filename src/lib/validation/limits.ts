/**
 * Upper bounds for browser-supplied configuration values.
 *
 * Server Actions are public POST endpoints. The form's `maxLength` and
 * `min`/`max` attributes are a convenience for the person typing, not a
 * boundary: anyone can post a larger value directly. Postgres `text` accepts
 * a megabyte, and every stored name is rendered back into a dashboard list,
 * so an unbounded value makes the app slow or unreadable rather than failing
 * cleanly.
 *
 * The numbers are deliberately generous. No real rule name needs more than
 * 100 characters, and Discord itself caps message content at 2,000 and a
 * button label at 80, so a value beyond those limits cannot work anyway.
 */
export const INPUT_LIMITS = {
  /** Names are shown in every list; keep them scannable. */
  name: 100,
  /** Descriptions are shown in full on the item's row. */
  description: 500,
  /** One emoji, allowing for multi-codepoint sequences. */
  icon: 32,
  /** A per-requirement label inside a challenge. */
  label: 100,
  /** One entry in the word filter. */
  blockedWord: 100,
  /** The whole word filter. Each entry is checked separately. */
  blockedWords: 500,
  /** Discord's own message content limit. */
  customMessage: 2_000,
  /** Discord's own button label limit. */
  buttonLabel: 80,
  /** Condition thresholds. */
  threshold: 1_000_000,
  /** XP amounts granted by a reward. */
  xpAmount: 1_000_000,
  /** Requirement rows on one challenge. */
  challengeRequirements: 20,
  /** Messages allowed inside a spam window. */
  messageLimit: 10_000,
  /** Joins inside a raid window. */
  joinThreshold: 10_000,
} as const;
