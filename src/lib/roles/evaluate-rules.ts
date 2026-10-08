import type { ProgressionMetric } from "@prisma/client";

import {
  METRIC_UNITS,
  metricValue,
  type MemberStats,
} from "@/lib/progression/metrics";

/**
 * Deciding whether a member qualifies for a role.
 *
 * Pure functions with no Discord or database access, so the thresholds that
 * grant real roles in a real server can be tested properly (PRD section 7.6).
 *
 * Metric maths lives in `lib/progression/metrics`, shared with rewards, so a
 * threshold means the same thing in both places.
 */

export {
  AVAILABLE_METRICS as SUPPORTED_METRICS,
  UNAVAILABLE_METRICS,
} from "@/lib/progression/metrics";
export type { MemberStats } from "@/lib/progression/metrics";

/** A configured rule, as stored. */
export interface RoleRuleInput {
  id: string;
  name: string;
  metric: ProgressionMetric;
  threshold: number;
  roleId: string;
  roleName: string;
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
  return `${rule.name} (${rule.threshold} ${METRIC_UNITS[rule.metric]} -> @${rule.roleName})`;
}