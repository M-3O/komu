import type { ChallengeRequirementType } from "@prisma/client";

/**
 * Reading challenge progress.
 *
 * A challenge is a structured, time-bounded goal, which is what separates it
 * from a reward. A reward checks a member's lifetime total; a challenge counts
 * what the member did *during the challenge*. That is why progress is
 * accumulated here rather than derived from `GuildMember.messageCount`:
 * creating a challenge today must not credit a member with last month's
 * messages.
 *
 * Pure functions, so completion can be tested without Discord or a database.
 */

/** One line item of a challenge. All requirements must be met. */
export interface ChallengeRequirementInput {
  id: string;
  type: ChallengeRequirementType;
  threshold: number;
  label: string | null;
}

/**
 * What a member has done during a challenge.
 *
 * `messages` and `attendance` are counts accumulated since the challenge
 * started. `level` is the member's current level rather than a count,
 * because a level never decreases, so there is nothing to accumulate.
 */
export interface ChallengeCounters {
  messages: number;
  attendance: number;
  level: number;
}

/** Progress per requirement type, stored as JSON on the progress row. */
export type StoredProgress = {
  messages?: number;
  attendance?: number;
};

/** A stored count, if it is a usable number. */
function usableCount(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value)) return undefined;
  if (value < 0) return undefined;

  return Math.floor(value);
}

/**
 * Read a stored progress blob.
 *
 * The column is Prisma `Json`, so its type is `JsonValue`: nothing about it is
 * guaranteed at compile time. It is parsed rather than cast, because a bad
 * value should cost a member their progress, not produce `NaN` that silently
 * reads as "met" or crash the dashboard.
 */
export function parseStoredProgress(value: unknown): StoredProgress {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};

  const record = value as Record<string, unknown>;
  const messages = usableCount(record.messages);
  const attendance = usableCount(record.attendance);

  return {
    ...(messages === undefined ? {} : { messages }),
    ...(attendance === undefined ? {} : { attendance }),
  };
}

/** Read stored progress, defaulting anything missing to zero. */
export function countersFrom(progress: StoredProgress | null, level: number): ChallengeCounters {
  return {
    messages: progress?.messages ?? 0,
    attendance: progress?.attendance ?? 0,
    level,
  };
}

/** The member's progress against one requirement, in that requirement's units. */
export function requirementProgress(
  requirement: ChallengeRequirementInput,
  counters: ChallengeCounters,
): number {
  switch (requirement.type) {
    case "MESSAGE_COUNT":
      return counters.messages;
    case "STREAM_ATTENDANCE":
      return counters.attendance;
    case "LEVEL":
      return counters.level;
    case "WATCH_TIME_HOURS":
      // Never offered, because nothing collects watch time. If it ever is,
      // this returning 0 is the safe direction: it cannot complete by accident.
      return 0;
  }
}

/** Whether one requirement has been met. */
export function requirementMet(
  requirement: ChallengeRequirementInput,
  counters: ChallengeCounters,
): boolean {
  return requirementProgress(requirement, counters) >= requirement.threshold;
}

/** Where a member stands against every requirement of a challenge. */
export interface RequirementStatus {
  requirement: ChallengeRequirementInput;
  current: number;
  threshold: number;
  met: boolean;
}

/** Per-requirement status, for the dashboard and the `/challenge` command. */
export function requirementStatuses(
  requirements: ChallengeRequirementInput[],
  counters: ChallengeCounters,
): RequirementStatus[] {
  return requirements.map((requirement) => {
    const current = requirementProgress(requirement, counters);

    return {
      requirement,
      current,
      threshold: requirement.threshold,
      met: current >= requirement.threshold,
    };
  });
}

/**
 * Whether every requirement is met.
 *
 * A challenge with no requirements is never complete. Completing it would be
 * indistinguishable from having been handed the reward for nothing.
 */
export function isComplete(
  requirements: ChallengeRequirementInput[],
  counters: ChallengeCounters,
): boolean {
  if (requirements.length === 0) return false;

  return requirements.every((requirement) => requirementMet(requirement, counters));
}

/**
 * Completion as a percentage.
 *
 * Each requirement contributes equally, so one long requirement cannot
 * outweigh three short ones. A challenge with no requirements reads 0.
 */
export function completionPercent(
  requirements: ChallengeRequirementInput[],
  counters: ChallengeCounters,
): number {
  if (requirements.length === 0) return 0;

  const parts = requirements.map((requirement) =>
    Math.min(1, requirementProgress(requirement, counters) / requirement.threshold),
  );

  const average = parts.reduce((sum, part) => sum + part, 0) / parts.length;

  return Math.round(average * 100);
}

/** How a requirement is worded by default, e.g. "Send 20 messages". */
export const REQUIREMENT_LABELS: Record<ChallengeRequirementType, (threshold: number) => string> = {
  MESSAGE_COUNT: (n) => `Send ${n} ${n === 1 ? "message" : "messages"}`,
  STREAM_ATTENDANCE: (n) => `Attend ${n} ${n === 1 ? "stream" : "streams"}`,
  LEVEL: (n) => `Reach level ${n}`,
  WATCH_TIME_HOURS: (n) => `Watch ${n} ${n === 1 ? "hour" : "hours"}`,
};

/** The label to show, using the creator's own wording when they gave one. */
export function requirementLabel(requirement: ChallengeRequirementInput): string {
  return requirement.label?.trim() || REQUIREMENT_LABELS[requirement.type](requirement.threshold);
}

/** The unit a requirement is counted in. */
export const REQUIREMENT_UNITS: Record<ChallengeRequirementType, string> = {
  MESSAGE_COUNT: "messages",
  STREAM_ATTENDANCE: "streams",
  LEVEL: "level",
  WATCH_TIME_HOURS: "hours watched",
};

/**
 * Requirement types a creator can choose.
 *
 * Watch time is excluded for the same reason it is excluded from roles and
 * rewards: nothing collects it, so a watch-time challenge could never be
 * completed. Offering one would show a progress bar stuck at zero forever.
 */
export const AVAILABLE_REQUIREMENT_TYPES: ChallengeRequirementType[] = [
  "STREAM_ATTENDANCE",
  "MESSAGE_COUNT",
  "LEVEL",
];

export const UNAVAILABLE_REQUIREMENT_TYPES: Partial<
  Record<ChallengeRequirementType, string>
> = {
  WATCH_TIME_HOURS:
    "Watch time is not collected. Komu records stream visits, not minutes watched.",
};