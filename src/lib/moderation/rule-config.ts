import { ModerationActionType, ModerationRuleType } from "@prisma/client";

/**
 * How the moderation rule types are configured.
 *
 * Lives outside `app/dashboard/moderation/actions.ts` because that file is a
 * `"use server"` module, and those may only export async functions.
 */

/** Rule types a creator can choose. */
export const RULE_TYPES: ModerationRuleType[] = [
  "WORD_FILTER",
  "SPAM",
  "RAID_PROTECTION",
];

export const RULE_TYPE_LABELS: Record<ModerationRuleType, string> = {
  WORD_FILTER: "Word filter",
  SPAM: "Spam protection",
  RAID_PROTECTION: "Anti-raid",
};

/**
 * Which actions make sense for which rule type.
 *
 * The schema allows any pairing, but banning on a word-filter match is almost
 * never intended, and offering it invites a misconfiguration that is awkward
 * to undo.
 */
export const ACTIONS_FOR_TYPE: Record<ModerationRuleType, ModerationActionType[]> = {
  WORD_FILTER: [ModerationActionType.DELETE_MESSAGE, ModerationActionType.WARN],
  SPAM: [ModerationActionType.TIMEOUT, ModerationActionType.KICK, ModerationActionType.BAN],
  RAID_PROTECTION: [ModerationActionType.TIMEOUT, ModerationActionType.KICK],
};

export const ACTION_LABELS: Record<ModerationActionType, string> = {
  DELETE_MESSAGE: "Delete the message",
  WARN: "Warn the member",
  TIMEOUT: "Timeout the member",
  KICK: "Kick the member",
  BAN: "Ban the member",
};

/** A one-line summary of a rule's configuration, for the dashboard list. */
export function describeRuleConfig(rule: {
  type: ModerationRuleType;
  action: ModerationActionType;
  blockedWords: string[];
  messageLimit: number | null;
  windowSeconds: number | null;
  joinThreshold: number | null;
  joinWindowSeconds: number | null;
  actionDurationMins: number | null;
}): string {
  const action = ACTION_LABELS[rule.action].toLowerCase();

  switch (rule.type) {
    case "WORD_FILTER": {
      const count = rule.blockedWords.length;
      const listed = rule.blockedWords.slice(0, 5).join(", ");
      const rest = count > 5 ? ` and ${count - 5} more` : "";

      return `${action} when a message contains ${listed}${rest}`;
    }
    case "SPAM":
      return `${action} after ${rule.messageLimit} messages in ${rule.windowSeconds}s${
        rule.action === "TIMEOUT" ? ` for ${rule.actionDurationMins}m` : ""
      }`;
    case "RAID_PROTECTION":
      return `${action} when ${rule.joinThreshold} members join in ${rule.joinWindowSeconds}s${
        rule.action === "TIMEOUT" ? ` for ${rule.actionDurationMins}m` : ""
      }`;
  }
}