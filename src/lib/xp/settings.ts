/**
 * XP settings validation and what they imply.
 *
 * PRD section 7.5 asks for a configurable XP amount, cooldown and daily cap.
 * Pure functions, so the rules that decide whether a creator's configuration
 * is usable are testable without a database.
 *
 * The implication maths matters as much as the validation. A creator setting a
 * daily cap of 200 with a 15 XP message reward has not realised that caps them
 * at 13 messages a day; showing the consequence is more useful than refusing
 * the value, since the value may well be deliberate.
 */

/** The stored settings, as the dashboard edits them. */
export interface XpSettingsInput {
  xpEnabled: boolean;
  xpMessageAmount: number;
  xpMessageMinLength: number;
  xpMessageCooldownSecs: number;
  xpDailyCap: number;
}

/** Upper bounds, so a typo cannot produce an absurd configuration. */
export const LIMITS = {
  xpMessageAmount: 10_000,
  xpMessageMinLength: 500,
  xpMessageCooldownSecs: 86_400,
  xpDailyCap: 1_000_000,
} as const;

export type SettingsProblem =
  | { field: keyof XpSettingsInput; message: string };

/**
 * Check a configuration.
 *
 * Returns every problem rather than the first, so the form can mark all the
 * wrong fields at once instead of making the creator resubmit to discover the
 * second one.
 */
export function validateSettings(input: XpSettingsInput): SettingsProblem[] {
  const problems: SettingsProblem[] = [];

  if (!Number.isInteger(input.xpMessageAmount) || input.xpMessageAmount < 1) {
    problems.push({
      field: "xpMessageAmount",
      message: "XP per message must be at least 1.",
    });
  } else if (input.xpMessageAmount > LIMITS.xpMessageAmount) {
    problems.push({
      field: "xpMessageAmount",
      message: `XP per message must be ${LIMITS.xpMessageAmount.toLocaleString()} or less.`,
    });
  }

  if (
    !Number.isInteger(input.xpMessageMinLength) ||
    input.xpMessageMinLength < 1
  ) {
    problems.push({
      field: "xpMessageMinLength",
      message: "Minimum message length must be at least 1.",
    });
  } else if (input.xpMessageMinLength > LIMITS.xpMessageMinLength) {
    problems.push({
      field: "xpMessageMinLength",
      message: `Minimum message length must be ${LIMITS.xpMessageMinLength} or less.`,
    });
  }

  if (
    !Number.isInteger(input.xpMessageCooldownSecs) ||
    input.xpMessageCooldownSecs < 0
  ) {
    problems.push({
      field: "xpMessageCooldownSecs",
      message: "Cooldown must be zero or a positive number of seconds.",
    });
  } else if (input.xpMessageCooldownSecs > LIMITS.xpMessageCooldownSecs) {
    problems.push({
      field: "xpMessageCooldownSecs",
      message: "Cooldown cannot be more than a day.",
    });
  }

  if (!Number.isInteger(input.xpDailyCap) || input.xpDailyCap < 0) {
    problems.push({
      field: "xpDailyCap",
      message: "Daily cap must be zero or a positive number. Zero means no limit.",
    });
  } else if (input.xpDailyCap > LIMITS.xpDailyCap) {
    problems.push({
      field: "xpDailyCap",
      message: `Daily cap must be ${LIMITS.xpDailyCap.toLocaleString()} or less.`,
    });
  }

  return problems;
}

/** Whether a configuration is usable. */
export function isValidSettings(input: XpSettingsInput): boolean {
  return validateSettings(input).length === 0;
}

/**
 * How many messages a member can earn from in a day.
 *
 * The cooldown is the ceiling, and the cap is the other one: whichever binds
 * first wins. Zero for either means that one does not apply.
 */
export function messagesPerDay(input: XpSettingsInput): number {
  const byCooldown =
    input.xpMessageCooldownSecs > 0
      ? Math.floor(86_400 / input.xpMessageCooldownSecs)
      : Number.POSITIVE_INFINITY;

  const byCap =
    input.xpDailyCap > 0
      ? Math.floor(input.xpDailyCap / input.xpMessageAmount)
      : Number.POSITIVE_INFINITY;

  const limit = Math.min(byCooldown, byCap);

  return Number.isFinite(limit) ? Math.max(limit, 0) : 0;
}

/**
 * Whether the cap is reached before the cooldown.
 *
 * Worth telling the creator which of the two limits is actually doing the
 * work, because raising the other one would then change nothing.
 */
export function capIsTheBindingLimit(input: XpSettingsInput): boolean {
  if (input.xpDailyCap <= 0 || input.xpMessageAmount <= 0) return false;

  const byCooldown =
    input.xpMessageCooldownSecs > 0
      ? Math.floor(86_400 / input.xpMessageCooldownSecs)
      : Number.POSITIVE_INFINITY;

  const byCap = Math.floor(input.xpDailyCap / input.xpMessageAmount);

  return byCap < byCooldown;
}

/** How a cooldown reads in minutes rather than seconds. */
export function cooldownMinutes(seconds: number): number {
  return Math.round((seconds / 60) * 10) / 10;
}