import type { ChallengeRequirementType } from "@prisma/client";

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import {
  countersFrom,
  isComplete,
  parseStoredProgress,
  type StoredProgress,
} from "./progress";

/**
 * Recording challenge progress.
 *
 * A challenge has its own counters, separate from the member's lifetime
 * totals. That is the whole difference from a reward: "attend 3 streams this
 * week" must not be satisfied by attendance from last year.
 *
 * Only counters for requirement types the challenge actually declares are
 * written. Without that check, sending a message would create a progress row
 * on an attendance-only challenge and fill it with numbers nobody reads.
 *
 * Deliberately not marked `server-only`: the standalone bot imports this.
 */

const log = createLogger("xp");

/**
 * What a member just did.
 *
 * Only activity that maps to a challenge requirement type matters, which is
 * why this is a closed union rather than a string. `JOINED` advances nothing;
 * it exists so a LEVEL requirement already met at the time a challenge is
 * created can still be checked.
 */
export type ChallengeActivity =
  | { kind: "MESSAGE" }
  | { kind: "STREAM_ATTENDANCE" }
  | { kind: "JOINED" };

/** The counter an activity advances, or null when it advances nothing. */
const ADVANCES: Record<
  ChallengeActivity["kind"],
  { type: ChallengeRequirementType; key: keyof StoredProgress } | null
> = {
  MESSAGE: { type: "MESSAGE_COUNT", key: "messages" },
  STREAM_ATTENDANCE: { type: "STREAM_ATTENDANCE", key: "attendance" },
  JOINED: null,
};

export interface UpdateChallengesResult {
  /** Challenges whose progress advanced. */
  updated: string[];
  /** Challenges newly completed by this activity. */
  completed: Array<{ id: string; name: string }>;
  /** Challenges ignored because they had ended. */
  expired: number;
  /** Challenges skipped because they had no requirements. */
  skippedNoRequirements: number;
  /** Challenges skipped because this activity did not concern them. */
  unrelated: number;
}

/**
 * Advance every enabled challenge a member is taking part in.
 *
 * Returns what changed so the caller can decide what to grant. Granting needs
 * Discord, so that part lives in `complete-challenge.ts`.
 */
export async function updateChallengeProgress(
  input: {
    guildId: string;
    memberId: string;
    /** The member's current level, for LEVEL requirements. */
    level: number;
    activity: ChallengeActivity;
    now?: Date;
  },
): Promise<UpdateChallengesResult> {
  const result: UpdateChallengesResult = {
    updated: [],
    completed: [],
    expired: 0,
    skippedNoRequirements: 0,
    unrelated: 0,
  };

  const now = input.now ?? new Date();

  const challenges = await prisma.challenge.findMany({
    where: { guildId: input.guildId, enabled: true },
    select: {
      id: true,
      name: true,
      endsAt: true,
      requirements: { select: { id: true, type: true, threshold: true, label: true } },
      progress: {
        where: { memberId: input.memberId },
        select: { id: true, progress: true, completedAt: true },
      },
    },
  });

  if (challenges.length === 0) return result;

  for (const challenge of challenges) {
    // A challenge with no requirements can never be completed, so tracking
    // progress for it would accumulate numbers that mean nothing.
    if (challenge.requirements.length === 0) {
      result.skippedNoRequirements += 1;
      continue;
    }

    // No progress is recorded after a challenge has ended. The row is left
    // alone rather than deleted, so a member can still see how far they got.
    if (challenge.endsAt && challenge.endsAt.getTime() <= now.getTime()) {
      result.expired += 1;
      continue;
    }

    const existing = challenge.progress[0];

    // Already completed. Leave it alone, including its counters, so the record
    // of what they had done when they finished stays intact.
    if (existing?.completedAt) continue;

    const stored = parseStoredProgress(existing?.progress);

    // Does this activity concern this challenge at all? If not, there is
    // nothing to write and nothing to check.
    const advance = ADVANCES[input.activity.kind];
    const requirementTypes = challenge.requirements.map((requirement) => requirement.type);

    // Whether this activity advances one of the challenge's own counters.
    const advancesRequirement =
      advance !== null && requirementTypes.includes(advance.type);

    // Level is read from the member rather than accumulated, and any
    // XP-earning activity can raise it. So a challenge with a level
    // requirement has to be re-checked on every activity, not only on join.
    // Skipping this left a level challenge uncompletable for anyone who
    // levelled up by messaging.
    const checksLevel = requirementTypes.includes("LEVEL");

    if (!advancesRequirement && !checksLevel) {
      result.unrelated += 1;
      continue;
    }

    // Only a requirement this challenge actually declares is counted, so a
    // message sent to a level-only challenge does not leave a stray counter.
    const next: StoredProgress = advancesRequirement
      ? { ...stored, [advance!.key]: ((stored[advance!.key] ?? 0) as number) + 1 }
      : { ...stored };

    const counters = countersFrom(next, input.level);

    const complete = isComplete(challenge.requirements, counters);

    // Nothing changed and the challenge is still incomplete: skip the write
    // entirely. This is the common case on a busy server, where most messages
    // concern no challenge at all.
    if (existing && !advancesRequirement && !complete) continue;

    // The row is created on the member's first relevant activity rather than
    // when the challenge is created, so a creator does not get a progress row
    // for every member the moment they set a challenge up.
    await prisma.challengeProgress.upsert({
      where: {
        challengeId_memberId: {
          challengeId: challenge.id,
          memberId: input.memberId,
        },
      },
      create: {
        guildId: input.guildId,
        challengeId: challenge.id,
        memberId: input.memberId,
        progress: next,
        completedAt: complete ? now : null,
      },
      update: {
        progress: next,
        // Only ever null -> a timestamp, because a completed row was already
        // skipped above.
        ...(complete ? { completedAt: now } : {}),
      },
    });

    if (advancesRequirement) {
      result.updated.push(challenge.name);
    }

    if (complete) {
      result.completed.push({ id: challenge.id, name: challenge.name });
      log.info("Challenge completed", {
        guildId: input.guildId,
        memberId: input.memberId,
        challenge: challenge.name,
      });
    }
  }

  return result;
}