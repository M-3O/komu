import type { ProgressionMetric } from "@prisma/client";

import { METRIC_UNITS, meetsThreshold, type MemberStats } from "@/lib/progression/metrics";

/**
 * Deciding which rewards a member qualifies for.
 *
 * Pure functions, so the rules that hand out real rewards and real roles can
 * be tested without a database or Discord (PRD section 7.8).
 */

/** A reward as stored, with its actions. */
export interface RewardInput {
  id: string;
  name: string;
  enabled: boolean;
  conditionMetric: ProgressionMetric;
  conditionThreshold: number;
  /** A repeatable reward may be granted more than once. */
  repeatable: boolean;
  actions: Array<{ type: string }>;
}

/** A grant we already made, used to decide whether to grant again. */
export interface ExistingGrant {
  rewardId: string;
  memberId: string;
}

export type RewardEligibility =
  /** Condition met and not granted before. */
  | { eligible: true }
  /** Not granted, with the reason so callers can report it usefully. */
  | {
      eligible: false;
      reason: "ALREADY_GRANTED" | "NOT_MET" | "DISABLED" | "NO_ACTIONS";
    };

/** Has the member crossed the reward's threshold? */
export function conditionMet(
  reward: RewardInput,
  stats: MemberStats,
  now: Date = new Date(),
): boolean {
  return meetsThreshold(reward.conditionMetric, reward.conditionThreshold, stats, now);
}

/**
 * Decide whether a reward should be granted to a member.
 */
export function evaluateReward(
  reward: RewardInput,
  stats: MemberStats,
  grants: ExistingGrant[],
  memberId: string,
  now: Date = new Date(),
): RewardEligibility {
  if (!reward.enabled) return { eligible: false, reason: "DISABLED" };

  // A reward with no actions would record a grant and do nothing.
  if (reward.actions.length === 0) return { eligible: false, reason: "NO_ACTIONS" };

  if (!conditionMet(reward, stats, now)) return { eligible: false, reason: "NOT_MET" };

  // Repeatable rewards may be granted again; one-shot rewards may not.
  if (!reward.repeatable) {
    const already = grants.some(
      (grant) => grant.rewardId === reward.id && grant.memberId === memberId,
    );

    if (already) return { eligible: false, reason: "ALREADY_GRANTED" };
  }

  return { eligible: true };
}

/** Rewards eligible for this member, with the rest kept for diagnostics. */
export function partitionByEligibility(
  rewards: RewardInput[],
  stats: MemberStats,
  grants: ExistingGrant[],
  memberId: string,
  now: Date = new Date(),
): { eligible: RewardInput[]; skipped: Array<{ reward: RewardInput; reason: string }> } {
  const eligible: RewardInput[] = [];
  const skipped: Array<{ reward: RewardInput; reason: string }> = [];

  for (const reward of rewards) {
    const result = evaluateReward(reward, stats, grants, memberId, now);

    if (result.eligible) {
      eligible.push(reward);
    } else {
      skipped.push({ reward, reason: result.reason });
    }
  }

  return { eligible, skipped };
}

/** A short description of a reward, for logs and the dashboard. */
export function describeReward(
  reward: Pick<RewardInput, "name" | "conditionMetric" | "conditionThreshold">,
): string {
  return `${reward.name} (${reward.conditionThreshold} ${METRIC_UNITS[reward.conditionMetric]})`;
}