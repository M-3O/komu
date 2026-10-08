import { Suspense } from "react";

import { requireCurrentUser } from "@/lib/auth/current-user";
import {
  countersFrom,
  parseStoredProgress,
  requirementLabel,
  requirementStatuses,
  REQUIREMENT_UNITS,
  UNAVAILABLE_REQUIREMENT_TYPES,
} from "@/lib/challenges/progress";
import { prisma } from "@/lib/db";
import { listGuildRoles } from "@/lib/discord/rest";
import { ChallengeManager } from "./ChallengeManager";

export const metadata = { title: "Challenges" };

/** How a requirement type is worded in the picker. */
const REQUIREMENT_OPTIONS: Record<string, string> = {
  STREAM_ATTENDANCE: "Attend N streams",
  MESSAGE_COUNT: "Send N messages",
  LEVEL: "Reach level N",
};

const MAX_PROGRESS_ROWS = 25;

/**
 * Challenge configuration and progress (PRD section 7.9).
 *
 * Only requirement types with a working data source are offered. Hours
 * watched is excluded because nothing collects watch time, so a watch-time
 * challenge would show a progress bar stuck at zero forever.
 */
export default function ChallengesPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Challenges</h1>
        <p className="text-sm text-[color:var(--color-komu-muted)]">
          Give the community a shared goal. Everyone who finishes gets the XP
          and role you set.
        </p>
      </header>

      <Suspense fallback={<PanelSkeleton />}>
        <ChallengesPanel />
      </Suspense>
    </div>
  );
}

async function ChallengesPanel() {
  await requireCurrentUser("/dashboard/challenges");

  const guild = await prisma.guild.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, discordId: true },
  });

  if (!guild) {
    return (
      <p className="rounded-lg border border-[color:var(--color-komu-border)] p-4 text-sm text-[color:var(--color-komu-muted)]">
        Connect a Discord server first.
      </p>
    );
  }

  const challenges = await prisma.challenge.findMany({
    where: { guildId: guild.id },
    select: {
      id: true,
      name: true,
      description: true,
      enabled: true,
      endsAt: true,
      xpReward: true,
      rewardRoleName: true,
      requirements: { select: { id: true, type: true, threshold: true, label: true } },
      progress: {
        select: {
          id: true,
          progress: true,
          completedAt: true,
          rewardGivenAt: true,
          member: { select: { level: true, username: true, nickname: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: MAX_PROGRESS_ROWS,
      },
      _count: { select: { progress: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const completedCounts = await prisma.challengeProgress.groupBy({
    by: ["challengeId"],
    where: {
      guildId: guild.id,
      completedAt: { not: null },
    },
    _count: { _all: true },
  });

  const completedByChallenge = new Map(
    completedCounts.map((entry) => [entry.challengeId, entry._count._all]),
  );

  const roles = await listGuildRoles(guild.discordId);

  const unavailable = Object.entries(UNAVAILABLE_REQUIREMENT_TYPES);

  return (
    <div className="flex flex-col gap-6">
      <ChallengeManager
        challenges={challenges.map((challenge) => ({
          id: challenge.id,
          name: challenge.name,
          description: challenge.description,
          enabled: challenge.enabled,
          endsAt: challenge.endsAt ? challenge.endsAt.toISOString() : null,
          xpReward: challenge.xpReward,
          rewardRoleName: challenge.rewardRoleName,
          requirements: challenge.requirements.map((requirement) => ({
            label: requirementLabel(requirement),
          })),
          enrolled: challenge._count.progress,
          completed: completedByChallenge.get(challenge.id) ?? 0,
        }))}
        roles={roles
          .filter((role) => role.id !== guild.discordId)
          .map((role) => ({ id: role.id, label: `@${role.name}` }))}
        requirementTypes={Object.entries(REQUIREMENT_OPTIONS).map(([value, label]) => ({
          value,
          label,
        }))}
        progress={challenges.flatMap((challenge) =>
          challenge.progress.map((row) => {
            const counters = countersFrom(parseStoredProgress(row.progress), row.member.level);

            return {
              key: row.id,
              username: row.member.username,
              nickname: row.member.nickname,
              completed: Boolean(row.completedAt),
              completedAt: row.completedAt?.toISOString() ?? null,
              challengeName: challenge.name,
              lines: requirementStatuses(challenge.requirements, counters).map((status) => {
                const value = status.met
                  ? "done"
                  : `${Math.min(status.current, status.threshold)} of ${
                      status.threshold
                    } ${REQUIREMENT_UNITS[status.requirement.type]}`;

                return `${challenge.name}: ${requirementLabel(status.requirement)} — ${value}`;
              }),
            };
          }),
        )}
      />

      {unavailable.length > 0 ? (
        <section className="rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-4">
          <h2 className="text-sm font-semibold">Not available yet</h2>
          <ul className="mt-2 flex list-inside list-disc flex-col gap-1 text-sm text-[color:var(--color-komu-muted)]">
            {unavailable.map(([type, reason]) => (
              <li key={type}>{reason}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-xs text-[color:var(--color-komu-muted)]">
        Progress counts activity from the moment a member first does something
        the challenge asks for, so a new challenge never credits past activity.
        Members can check their own progress with{" "}
        <code className="text-[color:var(--color-komu-text)]">/challenge</code>.
      </p>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div
      className="h-64 animate-pulse rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]"
      aria-hidden
    />
  );
}