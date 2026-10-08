import { Suspense } from "react";

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
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Achievements</h1>
        <p className="text-sm text-[color:var(--color-komu-muted)]">
          Permanent milestones. Unlike a challenge, an achievement measures
          everything a member has ever done and never expires.
        </p>
      </header>

      <Suspense fallback={<PanelSkeleton />}>
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
      <p className="rounded-lg border border-[color:var(--color-komu-border)] p-4 text-sm text-[color:var(--color-komu-muted)]">
        Connect a Discord server first.
      </p>
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

  const unavailable = Object.entries(UNAVAILABLE_ACHIEVEMENT_TYPES);

  return (
    <div className="flex flex-col gap-6">
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
        Achievements are checked on the same activity that drives roles,
        rewards and challenges. Members can see theirs with{" "}
        <code className="text-[color:var(--color-komu-text)]">/achievements</code>, and
        unlocked ones also appear on <code>/profile</code>.
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