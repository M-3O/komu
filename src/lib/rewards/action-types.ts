import type { RewardActionType } from "@prisma/client";

/**
 * The reward effects a creator can configure.
 *
 * Lives outside `app/dashboard/rewards/actions.ts` because that file is a
 * `"use server"` module, and those may only export async functions.
 *
 * Giveaway entry is in the schema but is deliberately absent: there is no
 * Giveaway entity to record an entry against, so offering it would create a
 * reward that looks configured and does nothing.
 */
export const CONFIGURABLE_ACTION_TYPES: RewardActionType[] = [
  "GIVE_XP",
  "ADD_ROLE",
  "REMOVE_ROLE",
  "UNLOCK_ACHIEVEMENT",
];

export const ACTION_TYPE_LABELS: Record<RewardActionType, string> = {
  GIVE_XP: "Give XP",
  ADD_ROLE: "Give a role",
  REMOVE_ROLE: "Take away a role",
  UNLOCK_ACHIEVEMENT: "Unlock an achievement",
  // Never selectable, but present so the record type stays complete.
  GIVEAWAY_ENTRY: "Giveaway entry (not available yet)",
};