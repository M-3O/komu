import { Gift, Repeat, Sparkles, Terminal, Trophy, Users } from "lucide-react";
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
import { prisma } from "@/lib/db";
import { listGuildRoles } from "@/lib/discord/rest";
import { METRIC_LABELS, METRIC_UNITS, UNAVAILABLE_METRICS } from "@/lib/progression/metrics";
import { AVAILABLE_METRICS } from "@/lib/progression/metrics";
import {
  ACTION_TYPE_LABELS,
  CONFIGURABLE_ACTION_TYPES,
} from "@/lib/rewards/action-types";
import { RewardManager } from "./RewardManager";

export const metadata = { title: "Rewards" };

/**
 * Reward configuration.
 *
 * A reward is a condition over one of the metrics Komu actually tracks plus
 * one action. Only metrics with a working data source are offered, for the
 * same reason role rules do not offer watch time: a rule that can never fire
 * is worse than one that is not offered.
 */
export default function RewardsPage() {
  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        eyebrow="Gamification / rewards engine"
        title="Rewards engine"
        description="Turn milestones into XP, Discord roles, or achievement unlocks — automatically."
        actions={
          <>
            <Link href="/dashboard/challenges" className="komu-btn komu-btn-secondary">
              <Trophy className="h-4 w-4" />
              Challenges
            </Link>
            <Link href="/dashboard/achievements" className="komu-btn komu-btn-primary">
              <Sparkles className="h-4 w-4" />
              Achievements
            </Link>
          </>
        }
      />

      <Suspense fallback={<RewardsSkeleton />}>
        <RewardsPanel />
      </Suspense>
    </div>
  );
}

/**
 * How an action is worded in the reward list.
 *
 * The achievement name comes from a lookup rather than a relation: the
 * schema stores `achievementId` on the action without a Prisma relation, so
 * there is nothing to include.
 */
function describeAction(
  action: {
    type: string;
    xpAmount: number | null;
    roleName: string | null;
    achievementId: string | null;
  },
  achievementNames: Map<string, string>,
): string {
  switch (action.type) {
    case "GIVE_XP":
      return `${action.xpAmount ?? 0} XP`;
    case "ADD_ROLE":
      return `@${action.roleName ?? "role"}`;
    case "REMOVE_ROLE":
      return `remove @${action.roleName ?? "role"}`;
    case "UNLOCK_ACHIEVEMENT": {
      const name = action.achievementId
        ? achievementNames.get(action.achievementId)
        : undefined;

      return `unlock ${name ?? "an achievement"}`;
    }
    default:
      return action.type;
  }
}

async function RewardsPanel() {
  await requireCurrentUser("/dashboard/rewards");

  const guild = await prisma.guild.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, discordId: true },
  });

  if (!guild) {
    return (
      <EmptyState
        icon={Gift}
        title="Connect a Discord server first"
        description="Rewards are scoped to the connected server."
        action={
          <Link href="/setup" className="komu-btn komu-btn-primary">
            Open setup
          </Link>
        }
      />
    );
  }

  const [rewards, achievements, allRoles] = await Promise.all([
    prisma.reward.findMany({
      where: { guildId: guild.id },
      select: {
        id: true,
        name: true,
        description: true,
        conditionMetric: true,
        conditionThreshold: true,
        repeatable: true,
        enabled: true,
        actions: {
          select: {
            type: true,
            xpAmount: true,
            roleName: true,
            achievementId: true,
          },
        },
        _count: { select: { grants: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.achievement.findMany({
      where: { guildId: guild.id },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    listGuildRoles(guild.discordId),
  ]);

  // @everyone is the server itself and cannot be assigned.
  const roles = allRoles
    .filter((role) => role.id !== guild.discordId)
    .map((role) => ({ id: role.id, label: `@${role.name}` }));

  const achievementNames = new Map(
    achievements.map((achievement) => [achievement.id, achievement.name]),
  );

  const unavailable = Object.entries(UNAVAILABLE_METRICS);
  const active = rewards.filter((reward) => reward.enabled).length;
  const grants = rewards.reduce((sum, reward) => sum + reward._count.grants, 0);
  const repeatable = rewards.filter((reward) => reward.repeatable).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Reward rules"
          value={rewards.length.toString()}
          hint="Configured conditions"
          icon={Gift}
          tone="accent"
        />
        <MetricCard
          label="Active rewards"
          value={active.toString()}
          hint={`${rewards.length - active} paused`}
          icon={Sparkles}
          tone={active > 0 ? "success" : "neutral"}
        />
        <MetricCard
          label="Total payouts"
          value={grants.toLocaleString()}
          hint="Across every reward"
          icon={Users}
          tone="violet"
        />
        <MetricCard
          label="Repeatable"
          value={repeatable.toString()}
          hint="Can pay out more than once"
          icon={Repeat}
          tone="warning"
        />
      </div>

      <RewardManager
        rewards={rewards.map((reward) => ({
          id: reward.id,
          name: reward.name,
          description: reward.description,
          metricLabel: METRIC_UNITS[reward.conditionMetric],
          threshold: reward.conditionThreshold,
          repeatable: reward.repeatable,
          enabled: reward.enabled,
          grantCount: reward._count.grants,
          actions: reward.actions.map((action) => describeAction(action, achievementNames)),
        }))}
        roles={roles}
        achievements={achievements}
        metrics={AVAILABLE_METRICS.map((metric) => ({
          value: metric,
          label: METRIC_LABELS[metric],
        }))}
        actionTypes={CONFIGURABLE_ACTION_TYPES.map((type) => ({
          value: type,
          label: ACTION_TYPE_LABELS[type],
        }))}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Granting by hand"
          description="One member, one reward, on demand."
          icon={Terminal}
          action={<Badge tone="accent">/reward</Badge>}
        >
          <p className="text-xs leading-5 text-[color:var(--color-komu-muted)]">
            Use{" "}
            <code className="rounded border border-[color:var(--color-komu-border-muted)] bg-white/[0.03] px-1.5 py-0.5 text-[color:var(--color-komu-text)]">
              /reward
            </code>{" "}
            in Discord to grant a reward to one member. It can re-grant a reward
            they already have, but it will not hand out one they have not earned.
          </p>
        </Panel>

        {unavailable.length > 0 ? (
          <Panel
            title="Signals not collected yet"
            description="Shown rather than silently omitted."
            icon={Repeat}
            action={<Badge tone="neutral">{unavailable.length}</Badge>}
          >
            <ul className="flex flex-col gap-2">
              {unavailable.map(([metric, reason]) => (
                <li
                  key={metric}
                  className="rounded-lg border border-[color:var(--color-komu-border)] bg-white/[0.015] px-3 py-2 text-xs leading-5 text-[color:var(--color-komu-muted)]"
                >
                  {reason}
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>

      <p className="text-[11px] leading-5 text-[color:var(--color-komu-muted)]">
        Rewards are checked whenever a member sends a qualifying message, reacts
        to a live alert, or joins the server. A one-shot reward is granted once
        per member.
      </p>
    </div>
  );
}

function RewardsSkeleton() {
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
      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <div className="h-80 animate-pulse rounded-2xl border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]" />
        <div className="h-80 animate-pulse rounded-2xl border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]" />
      </div>
    </div>
  );
}
