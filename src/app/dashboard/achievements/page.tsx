import { Award, Medal, Sparkles, Trophy, Users } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import {
  Badge,
  EmptyState,
  MetricCard,
  PageHeader,
  Panel,
} from "@/components/dashboard/ui";
import {
  ACHIEVEMENT_TYPE_LABELS,
  ACHIEVEMENT_UNITS,
  AVAILABLE_ACHIEVEMENT_TYPES,
  defaultThresholdFor,
  UNAVAILABLE_ACHIEVEMENT_TYPES,
} from "@/lib/achievements/evaluate";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { listGuildRoles } from "@/lib/discord/rest";
import { AchievementManager } from "./AchievementManager";

export const metadata = { title: "Achievements" };

const MAX_UNLOCKS_SHOWN = 20;

/**
 * Achievement configuration and unlocks (PRD section 7.10).
 *
 * Types are predefined, per the V1 simplicity rule. Hours watched is excluded
 * because nothing collects watch time, so an achievement on it could never be
 * earned.
 */
export default function AchievementsPage() {
  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        eyebrow="Gamification / milestones"
        title="Achievements & legacy"
        description="Permanent milestones that measure everything a member has ever done. Unlocks never expire and are never taken away."
        actions={
          <>
            <Link href="/dashboard/challenges" className="komu-btn komu-btn-secondary">
              <Trophy className="h-4 w-4" />
              Challenges
            </Link>
            <Link href="/dashboard/rewards" className="komu-btn komu-btn-primary">
              <Sparkles className="h-4 w-4" />
              Rewards engine
            </Link>
          </>
        }
      />

      <Suspense fallback={<AchievementsSkeleton />}>
        <AchievementsPanel />
      </Suspense>
    </div>
  );
}

async function AchievementsPanel() {
  await requireCurrentUser("/dashboard/achievements");

  const guild = await prisma.guild.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, discordId: true },
  });

  if (!guild) {
    return (
      <EmptyState
        icon={Medal}
        title="Connect a Discord server first"
        description="Achievements are scoped to the connected server."
        action={
          <Link href="/setup" className="komu-btn komu-btn-primary">
            Open setup
          </Link>
        }
      />
    );
  }

  const [achievements, unlocks, allRoles] = await Promise.all([
    prisma.achievement.findMany({
      where: { guildId: guild.id },
      select: {
        id: true,
        name: true,
        description: true,
        icon: true,
        hidden: true,
        enabled: true,
        type: true,
        threshold: true,
        xpReward: true,
        roleName: true,
        _count: { select: { unlockedBy: true } },
      },
      orderBy: { threshold: "asc" },
    }),
    prisma.memberAchievement.findMany({
      where: { guildId: guild.id },
      select: {
        id: true,
        unlockedAt: true,
        member: { select: { username: true, nickname: true } },
        achievement: { select: { name: true, icon: true } },
      },
      orderBy: { unlockedAt: "desc" },
      take: MAX_UNLOCKS_SHOWN,
    }),
    listGuildRoles(guild.discordId),
  ]);

  const unavailable = Object.entries(UNAVAILABLE_ACHIEVEMENT_TYPES)
    // FIRST_STREAM is deliberately not offered as a builder type: it maps onto
    // the plain stream-attendance counter and is created automatically. It is
    // not an unavailable metric, so listing it here would be misleading.
    .filter(([type]) => type !== "FIRST_STREAM")
    .map(([type, reason]) => ({
      label:
        ACHIEVEMENT_TYPE_LABELS[
          type as keyof typeof ACHIEVEMENT_TYPE_LABELS
        ] ?? type,
      reason: reason ?? "Not available yet.",
    }));
  const active = achievements.filter((achievement) => achievement.enabled).length;
  const unlockTotal = achievements.reduce(
    (sum, achievement) => sum + achievement._count.unlockedBy,
    0,
  );
  const rarest = achievements
    .filter((achievement) => achievement._count.unlockedBy > 0)
    .sort((a, b) => a._count.unlockedBy - b._count.unlockedBy)[0];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Achievements"
          value={achievements.length.toString()}
          hint="Configured milestones"
          icon={Medal}
          tone="accent"
        />
        <MetricCard
          label="Active"
          value={active.toString()}
          hint={`${achievements.length - active} paused`}
          icon={Sparkles}
          tone={active > 0 ? "success" : "neutral"}
        />
        <MetricCard
          label="Total unlocks"
          value={unlockTotal.toLocaleString()}
          hint="Permanent, across every member"
          icon={Users}
          tone="violet"
        />
        <MetricCard
          label="Rarest unlock"
          value={rarest ? rarest._count.unlockedBy.toLocaleString() : "—"}
          hint={rarest ? rarest.name : "No achievement has been claimed yet"}
          icon={Award}
          tone={rarest ? "warning" : "neutral"}
        />
      </div>

      <AchievementManager
        achievements={achievements.map((achievement) => ({
          id: achievement.id,
          name: achievement.name,
          description: achievement.description,
          icon: achievement.icon,
          type: ACHIEVEMENT_UNITS[achievement.type],
          threshold: achievement.threshold,
          xpReward: achievement.xpReward,
          roleName: achievement.roleName,
          enabled: achievement.enabled,
          hidden: achievement.hidden,
          unlockedBy: achievement._count.unlockedBy,
        }))}
        roles={allRoles
          .filter((role) => role.id !== guild.discordId)
          .map((role) => ({ id: role.id, label: `@${role.name}` }))}
        types={AVAILABLE_ACHIEVEMENT_TYPES.map((type) => ({
          value: type,
          label: ACHIEVEMENT_TYPE_LABELS[type],
          defaultThreshold: defaultThresholdFor(type),
        }))}
        unlocks={unlocks.map((unlock) => ({
          username: unlock.member.username,
          nickname: unlock.member.nickname,
          achievementName: unlock.achievement.name,
          icon: unlock.achievement.icon,
          unlockedAt: unlock.unlockedAt.toISOString(),
        }))}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="How unlocks are checked"
          description="The same activity that drives roles and rewards."
          icon={Award}
        >
          <p className="text-xs leading-5 text-[color:var(--color-komu-muted)]">
            Achievements are evaluated on the same activity that drives roles,
            rewards and challenges. Members can see theirs with{" "}
            <code className="rounded border border-[color:var(--color-komu-border-muted)] bg-white/[0.03] px-1.5 py-0.5 text-[color:var(--color-komu-text)]">
              /achievements
            </code>
            , and unlocked ones also appear on{" "}
            <code className="rounded border border-[color:var(--color-komu-border-muted)] bg-white/[0.03] px-1.5 py-0.5 text-[color:var(--color-komu-text)]">
              /profile
            </code>
            . Pausing an achievement stops new unlocks but never removes one
            that was already earned.
          </p>
        </Panel>

        {unavailable.length > 0 ? (
          <Panel
            title="Types not available yet"
            description="Shown rather than silently omitted."
            icon={Trophy}
            action={<Badge tone="neutral">{unavailable.length}</Badge>}
          >
            <ul className="flex flex-col gap-2">
              {unavailable.map((entry) => (
                <li
                  key={entry.label}
                  className="rounded-lg border border-[color:var(--color-komu-border)] bg-white/[0.015] px-3 py-2 text-xs leading-5 text-[color:var(--color-komu-muted)]"
                >
                  <span className="font-medium text-[color:var(--color-komu-text)]">
                    {entry.label}
                  </span>{" "}
                  — {entry.reason}
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

function AchievementsSkeleton() {
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
      <div className="grid gap-4 xl:grid-cols-[1fr_430px]">
        <div className="h-96 animate-pulse rounded-2xl border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]" />
        <div className="h-96 animate-pulse rounded-2xl border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]" />
      </div>
    </div>
  );
}
