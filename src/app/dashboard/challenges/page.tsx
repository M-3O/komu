import {
  CheckCircle2,
  Info,
  Sparkles,
  Swords,
  Target,
  Trophy,
  Users,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import {
  Badge,
  EmptyState,
  MetricCard,
  PageHeader,
  Panel,
} from "@/components/dashboard/ui";
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
    <div className="flex flex-col gap-7">
      <PageHeader
        eyebrow="Gamification / quests"
        title="Challenges & community quests"
        description="Give the community a shared goal. Everyone who finishes gets the XP and role you set."
        actions={
          <>
            <Link href="/dashboard/rewards" className="komu-btn komu-btn-secondary">
              <Trophy className="h-4 w-4" />
              Rewards engine
            </Link>
            <Link href="/dashboard/achievements" className="komu-btn komu-btn-primary">
              <Sparkles className="h-4 w-4" />
              Achievements
            </Link>
          </>
        }
      />

      <Suspense fallback={<ChallengesSkeleton />}>
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
      <EmptyState
        icon={Swords}
        title="Connect a Discord server first"
        description="Challenges are scoped to the connected server."
        action={
          <Link href="/setup" className="komu-btn komu-btn-primary">
            Open setup
          </Link>
        }
      />
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
  const active = challenges.filter((challenge) => challenge.enabled).length;
  const enrolled = challenges.reduce(
    (sum, challenge) => sum + challenge._count.progress,
    0,
  );
  const completed = challenges.reduce(
    (sum, challenge) => sum + (completedByChallenge.get(challenge.id) ?? 0),
    0,
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Challenge rules"
          value={challenges.length.toString()}
          hint="Configured for this server"
          icon={Swords}
          tone="accent"
        />
        <MetricCard
          label="Active quests"
          value={active.toString()}
          hint={`${challenges.length - active} paused`}
          icon={Target}
          tone={active > 0 ? "success" : "neutral"}
        />
        <MetricCard
          label="Member enrolments"
          value={enrolled.toLocaleString()}
          hint="Across all challenges"
          icon={Users}
          tone="violet"
        />
        <MetricCard
          label="Completions"
          value={completed.toLocaleString()}
          hint="All time"
          icon={CheckCircle2}
          tone="success"
        />
      </div>

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

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="How progress begins"
          description="No retroactive credit."
          icon={Info}
        >
          <p className="text-xs leading-5 text-[color:var(--color-komu-muted)]">
            Progress counts from the moment a member first does something the
            challenge asks for, so a new challenge never credits past activity.
            Members can check their own progress with{" "}
            <code className="rounded border border-[color:var(--color-komu-border-muted)] bg-white/[0.03] px-1.5 py-0.5 text-[color:var(--color-komu-text)]">
              /challenge
            </code>
            .
          </p>
        </Panel>

        {unavailable.length > 0 ? (
          <Panel
            title="Requirements not available yet"
            description="Shown rather than silently omitted."
            icon={Zap}
            action={<Badge tone="neutral">{unavailable.length}</Badge>}
          >
            <ul className="flex flex-col gap-2">
              {unavailable.map(([type, reason]) => (
                <li
                  key={type}
                  className="rounded-lg border border-[color:var(--color-komu-border)] bg-white/[0.015] px-3 py-2 text-xs leading-5 text-[color:var(--color-komu-muted)]"
                >
                  {reason}
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

function ChallengesSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="h-32 animate-pulse rounded-2xl border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]"
          />
        ))}
      </div>
      <div className="h-96 animate-pulse rounded-2xl border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]" />
    </div>
  );
}
