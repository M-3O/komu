import type { ProgressionMetric } from "@prisma/client";

/**
 * Deciding whether a member qualifies for a role.
 *
 * Pure functions with no Discord or database access, so the thresholds that
 * grant real roles in a real server can be tested properly (PRD section 7.6).
 */

/** The stored numbers a rule is measured against. */
export interface MemberStats {
  xp: number;
  level: number;
  messageCount: number;
  streamAttendanceCount: number;
  watchTimeMinutes: number;
  joinedAt: Date;
}

/** A configured rule, as stored. */
export interface RoleRuleInput {
  id: string;
  name: string;
  metric: ProgressionMetric;
  threshold: number;
  roleId: string;
  roleName: string;
}

/** Metrics with a working data source in V1. */
export const SUPPORTED_METRICS: ProgressionMetric[] = [
  "LEVEL",
  "XP",
  "MESSAGE_COUNT",
  "MEMBER_AGE_DAYS",
] as ProgressionMetric[];

/**
 * Why a metric is unavailable.
 *
 * The plan says to offer a watch-time rule only when the required data
 * exists (IMPLEMENTATION_PLAN section 10). V1 has no watch-time capture, so
 * the metric is not offered and saying so is more useful than showing a rule
 * that can never fire.
 */
export const UNAVAILABLE_METRICS: Partial<Record<ProgressionMetric, string>> = {
  WATCH_TIME_HOURS: "Watch time is not collected yet.",
  STREAM_ATTENDANCE: "Stream attendance is not captured yet.",
};

/** Whole days since a date, never negative. */
export function daysSince(date: Date, now: Date = new Date()): number {
  const elapsed = now.getTime() - date.getTime();
  if (elapsed <= 0) return 0;
  return Math.floor(elapsed / 86_400_000);
}

/**
 * The member's current value for a metric.
 *
 * Watch time is reported in hours because that is how thresholds are
 * configured; it is stored in minutes.
 */
export function metricValue(
  metric: ProgressionMetric,
  stats: MemberStats,
  now: Date = new Date(),
): number {
  switch (metric) {
    case "XP":
      return stats.xp;
    case "LEVEL":
      return stats.level;
    case "MESSAGE_COUNT":
      return stats.messageCount;
    case "STREAM_ATTENDANCE":
      return stats.streamAttendanceCount;
    case "WATCH_TIME_HOURS":
      return Math.floor(stats.watchTimeMinutes / 60);
    case "MEMBER_AGE_DAYS":
      return daysSince(stats.joinedAt, now);
  }
}

/** Does one rule's threshold sit at or below the member's value? */
export function ruleSatisfied(
  rule: RoleRuleInput,
  stats: MemberStats,
  now: Date = new Date(),
): boolean {
  return metricValue(rule.metric, stats, now) >= rule.threshold;
}

export interface RuleEvaluation {
  /** Eligible and not already holding the role. */
  toAssign: RoleRuleInput[];
  /** Eligible and already holding it. Nothing to do. */
  alreadyHeld: RoleRuleInput[];
  /** Not eligible yet. */
  unsatisfied: RoleRuleInput[];
}

/**
 * Sort enabled rules against a member's stats.
 *
 * `heldRoleIds` is the member's live Discord role list, which is the
 * authoritative answer to "do they already have this". Using it rather than
 * a cached database copy is what stops the bot re-adding a role after a
 * restart, which is an explicit requirement.
 */
export function evaluateRules(
  rules: RoleRuleInput[],
  stats: MemberStats,
  heldRoleIds: string[],
  now: Date = new Date(),
): RuleEvaluation {
  const held = new Set(heldRoleIds);

  const toAssign: RoleRuleInput[] = [];
  const alreadyHeld: RoleRuleInput[] = [];
  const unsatisfied: RoleRuleInput[] = [];

  for (const rule of rules) {
    if (!ruleSatisfied(rule, stats, now)) {
      unsatisfied.push(rule);
      continue;
    }

    if (held.has(rule.roleId)) {
      alreadyHeld.push(rule);
      continue;
    }

    toAssign.push(rule);
  }

  return { toAssign, alreadyHeld, unsatisfied };
}

/** A short description of a rule, for logs and the dashboard. */
export function describeRule(rule: RoleRuleInput): string {
  const units: Record<ProgressionMetric, string> = {
    XP: "XP",
    LEVEL: "level",
    MESSAGE_COUNT: "messages",
    STREAM_ATTENDANCE: "streams",
    WATCH_TIME_HOURS: "hours watched",
    MEMBER_AGE_DAYS: "days in server",
  };

  return `${rule.name} (${rule.threshold} ${units[rule.metric]} -> @${rule.roleName})`;
}