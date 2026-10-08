import { AchievementType, ProgressionMetric } from "@prisma/client";

import {
  AVAILABLE_METRICS,
  metricValue,
  METRIC_UNITS,
  UNAVAILABLE_METRICS,
  type MemberStats,
} from "@/lib/progression/metrics";

/**
 * Reading achievement progress.
 *
 * An achievement is a permanent, lifetime milestone. That is the whole
 * difference from a challenge: a challenge counts what happened during a
 * window, an achievement asks whether a lifetime total has reached a line.
 * So this reads the same `GuildMember` counters the roles and rewards use,
 * and there is no progress to store.
 *
 * Pure functions, so the rules that hand out XP and roles can be tested
 * without Discord or a database.
 */

/**
 * The metric each achievement type is measured against.
 *
 * `FIRST_STREAM` has no counter of its own: attending one stream is the same
 * as an attendance count reaching 1. Mapping it onto the existing metric
 * means one code path instead of a special case.
 */
const METRIC_FOR: Record<AchievementType, ProgressionMetric> = {
  FIRST_STREAM: ProgressionMetric.STREAM_ATTENDANCE,
  STREAM_ATTENDANCE_COUNT: ProgressionMetric.STREAM_ATTENDANCE,
  MESSAGE_COUNT: ProgressionMetric.MESSAGE_COUNT,
  LEVEL: ProgressionMetric.LEVEL,
  MEMBER_AGE_DAYS: ProgressionMetric.MEMBER_AGE_DAYS,
  WATCH_TIME_HOURS: ProgressionMetric.WATCH_TIME_HOURS,
};

/** An achievement as stored. */
export interface AchievementInput {
  id: string;
  name: string;
  type: AchievementType;
  threshold: number;
  enabled: boolean;
}

/** The lifetime value an achievement type measures. */
export function metricFor(type: AchievementType): ProgressionMetric {
  return METRIC_FOR[type];
}

/** The member's lifetime progress towards an achievement. */
export function achievementProgress(
  achievement: AchievementInput,
  stats: MemberStats,
  now: Date = new Date(),
): number {
  return metricValue(metricFor(achievement.type), stats, now);
}

/** Whether an achievement's requirement has been met. */
export function conditionMet(
  achievement: AchievementInput,
  stats: MemberStats,
  now: Date = new Date(),
): boolean {
  return achievementProgress(achievement, stats, now) >= achievement.threshold;
}

export type UnlockEligibility =
  /** Earned and not unlocked yet. */
  | { eligible: true }
  | {
      eligible: false;
      reason: "ALREADY_UNLOCKED" | "NOT_MET" | "DISABLED";
    };

/**
 * Decide whether an achievement should unlock for a member.
 */
export function evaluateUnlock(
  achievement: AchievementInput,
  stats: MemberStats,
  unlockedAchievementIds: string[],
  now: Date = new Date(),
): UnlockEligibility {
  if (!achievement.enabled) return { eligible: false, reason: "DISABLED" };

  if (unlockedAchievementIds.includes(achievement.id)) {
    return { eligible: false, reason: "ALREADY_UNLOCKED" };
  }

  if (!conditionMet(achievement, stats, now)) {
    return { eligible: false, reason: "NOT_MET" };
  }

  return { eligible: true };
}

/** Achievements to unlock, with the rest kept for diagnostics. */
export function partitionUnlocks(
  achievements: AchievementInput[],
  stats: MemberStats,
  unlockedAchievementIds: string[],
  now: Date = new Date(),
): { eligible: AchievementInput[]; skipped: Array<{ achievement: AchievementInput; reason: string }> } {
  const eligible: AchievementInput[] = [];
  const skipped: Array<{ achievement: AchievementInput; reason: string }> = [];

  for (const achievement of achievements) {
    const result = evaluateUnlock(achievement, stats, unlockedAchievementIds, now);

    if (result.eligible) {
      eligible.push(achievement);
    } else {
      skipped.push({ achievement, reason: result.reason });
    }
  }

  return { eligible, skipped };
}

/**
 * Achievement types a creator can choose.
 *
 * Built from the metrics that actually have data, so the list cannot drift
 * from `progression/metrics.ts`: adding a metric there makes it offerable
 * here without a second edit.
 */
const AVAILABLE_TYPES: AchievementType[] = (Object.keys(METRIC_FOR) as AchievementType[])
  .filter((type) => (AVAILABLE_METRICS as string[]).includes(METRIC_FOR[type]))
  // FIRST_STREAM is a specific milestone, not a general counter to tune, so
  // it is not offered alongside the plain count it maps onto.
  .filter((type) => type !== "FIRST_STREAM");

export const AVAILABLE_ACHIEVEMENT_TYPES: AchievementType[] = AVAILABLE_TYPES;

export const UNAVAILABLE_ACHIEVEMENT_TYPES: Partial<Record<AchievementType, string>> =
  Object.fromEntries(
    (Object.keys(METRIC_FOR) as AchievementType[])
      .filter((type) => !AVAILABLE_TYPES.includes(type))
      .map((type) => [type, UNAVAILABLE_METRICS[METRIC_FOR[type]] ?? "Not available yet."]),
  );

/** How an achievement type is worded in the dashboard picker. */
export const ACHIEVEMENT_TYPE_LABELS: Record<AchievementType, string> = {
  FIRST_STREAM: "First stream attended",
  STREAM_ATTENDANCE_COUNT: "N streams attended",
  MESSAGE_COUNT: "N messages sent",
  LEVEL: "Level N reached",
  MEMBER_AGE_DAYS: "N days in the server",
  WATCH_TIME_HOURS: "N hours watched",
};

/** The unit an achievement type is counted in. */
export const ACHIEVEMENT_UNITS: Record<AchievementType, string> = Object.fromEntries(
  (Object.keys(METRIC_FOR) as AchievementType[]).map((type) => [
    type,
    METRIC_UNITS[METRIC_FOR[type]],
  ]),
) as Record<AchievementType, string>;

/**
 * The threshold a creator starts from when picking a type.
 *
 * "First stream" means exactly one, so the field should not invite a creator
 * to set a different number for it.
 */
export function defaultThresholdFor(type: AchievementType): number {
  return type === "FIRST_STREAM" ? 1 : 10;
}

/** A short description of an achievement, for logs and the dashboard. */
export function describeAchievement(
  achievement: Pick<AchievementInput, "name" | "type" | "threshold">,
): string {
  const unit = ACHIEVEMENT_UNITS[achievement.type];

  return `${achievement.name} (${achievement.threshold} ${unit})`;
}