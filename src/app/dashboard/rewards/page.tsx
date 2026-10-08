import { Suspense } from "react";

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
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Rewards</h1>
        <p className="text-sm text-[color:var(--color-komu-muted)]">
          When a member reaches a milestone, give them XP, a role, or unlock an
          achievement for them.
        </p>
      </header>

      <Suspense fallback={<PanelSkeleton />}>
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
      <p className="rounded-lg border border-[color:var(--color-komu-border)] p-4 text-sm text-[color:var(--color-komu-muted)]">
        Connect a Discord server first.
      </p>
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

  return (
    <div className="flex flex-col gap-6">
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

      {unavailable.length > 0 ? (
        <section className="rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-4">
          <h2 className="text-sm font-semibold">Not available yet</h2>
          <ul className="mt-2 flex list-inside list-disc flex-col gap-1 text-sm text-[color:var(--color-komu-muted)]">
            {unavailable.map(([metric, reason]) => (
              <li key={metric}>{reason}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-4">
        <h2 className="text-sm font-semibold">Granting by hand</h2>
        <p className="mt-1 text-sm text-[color:var(--color-komu-muted)]">
          Use <code className="text-[color:var(--color-komu-text)]">/reward</code> in
          Discord to grant a reward to one member. It can re-grant a reward
          they already have, but it will not hand out one they have not earned.
        </p>
      </section>

      <p className="text-xs text-[color:var(--color-komu-muted)]">
        Rewards are checked whenever a member sends a qualifying message,
        reacts to a live alert, or joins the server. A one-shot reward is
        granted once per member.
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