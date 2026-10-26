import {
  BadgeCheck,
  Layers,
  Shield,
  ShieldCheck,
  Target,
  TrendingUp,
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
import { prisma } from "@/lib/db";
import { listGuildRoles } from "@/lib/discord/rest";
import { SUPPORTED_METRICS, UNAVAILABLE_METRICS } from "@/lib/roles/evaluate-rules";
import { RoleRuleManager } from "./RoleRuleManager";

export const metadata = { title: "Roles" };

/**
 * Role rule configuration.
 *
 * Roles come from Discord so the creator picks from real options. Only
 * metrics with a working data source are offered: the plan says to add a
 * watch-time rule only when the required data exists, and V1 does not
 * collect it.
 */
export default function RolesPage() {
  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        eyebrow="Engagement / role automation"
        title="Dynamic roles engine"
        description="Automatically give members a Discord role when they reach a milestone you trust."
        actions={
          <>
            <Link href="/dashboard/xp" className="komu-btn komu-btn-secondary">
              <TrendingUp className="h-4 w-4" />
              XP settings
            </Link>
            <Link href="/dashboard/leaderboards" className="komu-btn komu-btn-primary">
              <Target className="h-4 w-4" />
              View leaderboard
            </Link>
          </>
        }
      />

      <Suspense fallback={<RolesSkeleton />}>
        <RoleRulesPanel />
      </Suspense>
    </div>
  );
}

async function RoleRulesPanel() {
  await requireCurrentUser("/dashboard/roles");

  const guild = await prisma.guild.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, discordId: true, xpEnabled: true },
  });

  if (!guild) {
    return (
      <EmptyState
        icon={Shield}
        title="Connect a Discord server first"
        description="Komu needs a server before it can assign roles."
        action={
          <Link href="/setup" className="komu-btn komu-btn-primary">
            Open setup
          </Link>
        }
      />
    );
  }

  const [rules, allRoles] = await Promise.all([
    prisma.roleRule.findMany({
      where: { guildId: guild.id },
      select: {
        id: true,
        name: true,
        metric: true,
        threshold: true,
        roleId: true,
        roleName: true,
        enabled: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    listGuildRoles(guild.discordId),
  ]);

  // @everyone is the server itself and cannot be assigned.
  const roles = allRoles
    .filter((role) => role.id !== guild.discordId)
    .map((role) => ({
      id: role.id,
      label: `@${role.name}`,
      position: role.position,
    }))
    .sort((a, b) => b.position - a.position);

  const unavailable = Object.entries(UNAVAILABLE_METRICS);
  const active = rules.filter((rule) => rule.enabled).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Role rules"
          value={rules.length.toString()}
          hint="Configured for this server"
          icon={BadgeCheck}
          tone="accent"
        />
        <MetricCard
          label="Active rules"
          value={active.toString()}
          hint={
            rules.length === 0
              ? "No rules configured"
              : active === rules.length
                ? "All rules are listening"
                : `${rules.length - active} paused`
          }
          icon={ShieldCheck}
          tone={active > 0 ? "success" : "neutral"}
        />
        <MetricCard
          label="Server roles"
          value={roles.length.toString()}
          hint="Excluding @everyone"
          icon={Layers}
          tone="violet"
        />
        <MetricCard
          label="Signals available"
          value={SUPPORTED_METRICS.length.toString()}
          hint={guild.xpEnabled ? "XP progression is online" : "XP is paused; other signals still run"}
          icon={Target}
          tone={guild.xpEnabled ? "success" : "warning"}
        />
      </div>

      {roles.length === 0 ? (
        <Panel
          title="Roles unavailable"
          description="Komu could not read this server's role list."
          icon={Shield}
        >
          <p className="text-sm leading-6 text-[color:var(--color-komu-muted)]">
            Check that the bot is in the server and can see roles, then reload.
            No new rule can be saved until a role is available.
          </p>
          <div className="mt-3">
            <Badge tone="warning">Discord permissions</Badge>
          </div>
        </Panel>
      ) : (
        <RoleRuleManager
          roles={roles}
          rules={rules.map((rule) => ({
            id: rule.id,
            name: rule.name,
            metric: rule.metric,
            threshold: rule.threshold,
            roleId: rule.roleId,
            roleName: rule.roleName,
            enabled: rule.enabled,
          }))}
          availableMetrics={SUPPORTED_METRICS}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="How the engine evaluates"
          description="Rules are event-driven, not scheduled."
          icon={ShieldCheck}
        >
          <p className="text-xs leading-5 text-[color:var(--color-komu-muted)]">
            Rules are checked whenever a member sends a message and when they
            join. A role above the bot&apos;s highest role cannot be assigned.
            Completing a rule never removes a role that was already granted,
            even if the rule is later paused or deleted.
          </p>
        </Panel>

        {unavailable.length > 0 ? (
          <Panel
            title="Signals not collected yet"
            description="Shown rather than silently omitted."
            icon={Layers}
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
    </div>
  );
}

function RolesSkeleton() {
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
      <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
        <div className="h-72 animate-pulse rounded-2xl border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]" />
        <div className="h-72 animate-pulse rounded-2xl border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]" />
      </div>
    </div>
  );
}
